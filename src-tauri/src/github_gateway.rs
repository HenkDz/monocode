use serde::Serialize;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::{Condvar, Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const TTL: Duration = Duration::from_secs(60);
const CLOSED_TTL: Duration = Duration::from_secs(86400);
pub const LIMITED_MESSAGE: &str = "GitHub rate limit reached · showing last known data";

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PathUsage {
    calls: u64,
    points: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Budget {
    remaining: Option<u64>,
    limit: Option<u64>,
    reset_at: Option<String>,
    resource: Option<String>,
    status: &'static str,
    calls: u64,
    points: u64,
    paths: HashMap<String, PathUsage>,
}

impl Default for Budget {
    fn default() -> Self {
        Self {
            remaining: None,
            limit: None,
            reset_at: None,
            resource: None,
            status: "unknown",
            calls: 0,
            points: 0,
            paths: HashMap::new(),
        }
    }
}

#[derive(Clone)]
struct Cached {
    body: String,
    etag: Option<String>,
    until: SystemTime,
}

#[derive(Default)]
struct State {
    budget: Budget,
    reset: Option<SystemTime>,
    cache: HashMap<String, Cached>,
    running: HashSet<String>,
    snapshots: HashMap<String, (Value, SystemTime)>,
    resources: HashMap<String, (u64, u64, Option<String>, Option<SystemTime>)>,
    forced_pause: Option<SystemTime>,
    generation: u64,
}

#[derive(Default)]
pub struct Gateway {
    state: Mutex<State>,
    done: Condvar,
}

pub struct Response {
    pub body: String,
    pub headers: String,
    pub not_modified: bool,
    pub graphql_rate: Option<Value>,
}

pub fn shared() -> &'static Gateway {
    static GATEWAY: OnceLock<Gateway> = OnceLock::new();
    GATEWAY.get_or_init(Gateway::default)
}

pub fn read(args: &[&str]) -> bool {
    match args.first().copied() {
        Some("api") => {
            !args
                .windows(2)
                .any(|p| matches!(p[0], "--method" | "-X") && p[1] != "GET")
                && !args.iter().any(|arg| {
                    arg.strip_prefix("--method=")
                        .or_else(|| arg.strip_prefix("-X").filter(|method| !method.is_empty()))
                        .is_some_and(|method| method != "GET")
                })
                && !args.iter().any(|p| p.contains("mutation"))
                && (args.contains(&"graphql")
                    || !args.iter().any(|p| {
                        matches!(*p, "-f" | "-F" | "--field" | "--raw-field")
                            || p.starts_with("--field=")
                            || p.starts_with("--raw-field=")
                            || (p.starts_with("-f") || p.starts_with("-F")) && p.len() > 2
                    }))
        }
        Some("auth") => args.get(1) == Some(&"status"),
        _ => matches!(
            args.get(1).copied(),
            Some("view" | "list" | "diff" | "checks")
        ),
    }
}

fn key(root: &Path, args: &[&str]) -> String {
    // Explicit repository/API targets share data across all worktrees.
    let explicit = args.contains(&"--repo") || args.first() == Some(&"api");
    let root = if explicit {
        String::new()
    } else {
        root.to_string_lossy().into_owned()
    };
    format!("{root}\0{}", args.join("\0"))
}

fn epoch(reset: &str) -> Option<SystemTime> {
    let seconds = reset.parse::<u64>().ok().or_else(|| {
        time::OffsetDateTime::parse(reset, &time::format_description::well_known::Rfc3339)
            .ok()
            .and_then(|date| u64::try_from(date.unix_timestamp()).ok())
    })?;
    UNIX_EPOCH.checked_add(Duration::from_secs(seconds.saturating_add(1)))
}

impl State {
    fn expire_budget(&mut self, now: SystemTime) {
        self.resources
            .retain(|_, (_, _, _, reset)| !reset.is_some_and(|reset| now >= reset));
        if self.forced_pause.is_some_and(|reset| now >= reset) {
            self.forced_pause = None;
        }
        if self.forced_pause.is_some() {
            self.budget.status = "exhausted";
            self.budget.remaining = Some(0);
            return;
        }
        if let Some((resource, (remaining, limit, reset_at, reset))) = self
            .resources
            .iter()
            .min_by_key(|(_, (remaining, limit, _, _))| {
                remaining.saturating_mul(10000) / limit.max(&1)
            })
        {
            self.budget.remaining = Some(*remaining);
            self.budget.limit = Some(*limit);
            self.budget.reset_at = reset_at.clone();
            self.budget.resource = Some(resource.clone());
            self.reset = *reset;
            self.budget.status = if *remaining == 0 {
                "exhausted"
            } else if remaining.saturating_mul(10) <= *limit {
                "low"
            } else {
                "ok"
            };
        } else {
            self.budget.remaining = None;
            self.budget.status = "unknown";
            self.reset = None;
        }
    }

    fn observe(&mut self, path: &str, response: &Response) {
        let mut points = 0;
        let json = serde_json::from_str::<Value>(&response.body).unwrap_or(Value::Null);
        {
            let rate = response
                .graphql_rate
                .as_ref()
                .unwrap_or(&json["data"]["rateLimit"]);
            if let Some(remaining) = rate["remaining"].as_u64() {
                let reset_at = rate["resetAt"].as_str().map(str::to_string);
                let reset = reset_at.as_deref().and_then(epoch);
                self.resources.insert(
                    "graphql".into(),
                    (
                        remaining,
                        rate["limit"].as_u64().unwrap_or(5000),
                        reset_at,
                        reset,
                    ),
                );
                points = rate["cost"].as_u64().unwrap_or(0);
            }
        }
        let (mut remaining, mut limit, mut resource, mut reset_at, mut reset) =
            (None, None, None, None, None);
        for line in response.headers.lines() {
            let line = line.trim().trim_start_matches('<').trim();
            let Some((name, value)) = line.split_once(':') else {
                continue;
            };
            let value = value.trim();
            match name.to_ascii_lowercase().as_str() {
                "x-ratelimit-remaining" => remaining = value.parse().ok(),
                "x-ratelimit-limit" => limit = value.parse().ok(),
                "x-ratelimit-resource" => resource = Some(value.to_string()),
                "x-ratelimit-reset" => {
                    reset = epoch(value);
                    reset_at = value
                        .parse::<i64>()
                        .ok()
                        .and_then(|stamp| time::OffsetDateTime::from_unix_timestamp(stamp).ok())
                        .and_then(|date| {
                            date.format(&time::format_description::well_known::Rfc3339)
                                .ok()
                        });
                }
                _ => {}
            }
        }
        if let (Some(remaining), Some(limit)) = (remaining, limit) {
            self.resources.insert(
                resource.unwrap_or_else(|| "core".into()),
                (remaining, limit, reset_at, reset),
            );
        }
        self.expire_budget(SystemTime::now());
        self.budget.points += points;
        if points > 0 {
            self.budget.paths.entry(path.into()).or_default().points += points;
        }
    }
}

impl Gateway {
    pub fn polling_paused(&self) -> bool {
        matches!(self.budget().status, "low" | "exhausted")
    }
    pub fn observe_error_headers(&self, headers: String, body: String) {
        self.state.lock().unwrap().observe(
            "failed",
            &Response {
                body,
                headers,
                not_modified: false,
                graphql_rate: None,
            },
        );
    }
    pub fn budget(&self) -> Budget {
        let mut state = self.state.lock().unwrap();
        state.expire_budget(SystemTime::now());
        state.budget.clone()
    }

    pub fn invalidate(&self) {
        let mut state = self.state.lock().unwrap();
        state.cache.clear();
        state.snapshots.clear();
        state.generation += 1;
    }

    pub fn run(
        &self,
        root: &Path,
        args: &[&str],
        run: impl FnOnce(&[&str], Option<&str>) -> Result<Response, String>,
    ) -> Result<String, String> {
        let cacheable = read(args);
        let request_key = key(root, args);
        let path = if args.contains(&"r24-status-batch") {
            "pr status-batch".into()
        } else {
            args.iter().take(2).copied().collect::<Vec<_>>().join(" ")
        };
        let mut state = self.state.lock().unwrap();
        while state.running.contains(&request_key) {
            state = self.done.wait(state).unwrap();
        }
        let now = SystemTime::now();
        state.expire_budget(now);
        let previous = state.cache.get(&request_key).cloned();
        if cacheable && previous.as_ref().is_some_and(|cached| now < cached.until) {
            return Ok(previous.unwrap().body);
        }
        if state.budget.status == "exhausted" || (cacheable && state.budget.status == "low") {
            return previous
                .filter(|_| cacheable)
                .map(|cached| cached.body)
                .ok_or_else(|| LIMITED_MESSAGE.into());
        }
        state.running.insert(request_key.clone());
        let generation = state.generation;
        state.budget.calls += 1;
        state.budget.paths.entry(path.clone()).or_default().calls += 1;
        drop(state);
        let result = run(
            args,
            previous.as_ref().and_then(|cached| cached.etag.as_deref()),
        );
        let mut state = self.state.lock().unwrap();
        let result = match result {
            Ok(response) => {
                state.observe(&path, &response);
                let result = if response.not_modified {
                    previous
                        .as_ref()
                        .map(|cached| cached.body.clone())
                        .ok_or("GitHub returned no cached data".to_string())
                } else {
                    Ok(response.body.clone())
                };
                if let Ok(body) = &result {
                    if cacheable && generation == state.generation {
                        let closed = serde_json::from_str::<Value>(body)
                            .ok()
                            .is_some_and(|json| {
                                matches!(json["state"].as_str(), Some("CLOSED" | "MERGED"))
                            });
                        let etag = response
                            .headers
                            .lines()
                            .find_map(|line| {
                                let (name, value) =
                                    line.trim().trim_start_matches('<').trim().split_once(':')?;
                                name.eq_ignore_ascii_case("etag")
                                    .then(|| value.trim().to_string())
                            })
                            .or_else(|| previous.as_ref().and_then(|cached| cached.etag.clone()));
                        state.cache.insert(
                            request_key.clone(),
                            Cached {
                                body: body.clone(),
                                etag,
                                until: now + if closed { CLOSED_TTL } else { TTL },
                            },
                        );
                    } else if !cacheable {
                        state.cache.clear();
                        state.snapshots.clear();
                        state.generation += 1;
                    }
                }
                result
            }
            Err(error) => {
                let lower = error.to_ascii_lowercase();
                if lower.contains("rate limit")
                    || lower.contains("abuse detection")
                    || state.budget.status == "exhausted"
                {
                    let seconds = if lower.contains("secondary rate limit")
                        || lower.contains("abuse detection")
                    {
                        60
                    } else {
                        3600
                    };
                    state.forced_pause =
                        Some(state.reset.unwrap_or(now + Duration::from_secs(seconds)));
                    state.expire_budget(now);
                    previous
                        .filter(|_| cacheable)
                        .map(|cached| cached.body)
                        .ok_or_else(|| LIMITED_MESSAGE.to_string())
                } else {
                    Err(error)
                }
            }
        };
        state.running.remove(&request_key);
        self.done.notify_all();
        result
    }

    pub fn snapshot(&self, repo: &str) -> Option<Value> {
        self.state
            .lock()
            .unwrap()
            .snapshots
            .get(repo)
            .filter(|(_, until)| SystemTime::now() < *until)
            .map(|(rows, _)| rows.clone())
    }

    pub fn snapshot_fresh(&self, repo: &str) -> bool {
        let request_key = key(
            Path::new("."),
            &["pr", "view", "--repo", repo, "--json", "r24-status-batch"],
        );
        self.state
            .lock()
            .unwrap()
            .cache
            .get(&request_key)
            .is_some_and(|cached| SystemTime::now() < cached.until)
    }

    pub fn generation(&self) -> u64 {
        self.state.lock().unwrap().generation
    }

    pub fn store_snapshot(&self, repo: &str, rows: Value, generation: u64) {
        let mut state = self.state.lock().unwrap();
        if state.generation == generation {
            let now = SystemTime::now();
            let until = state
                .snapshots
                .get(repo)
                .map(|(_, until)| *until)
                .filter(|until| now < *until)
                .unwrap_or(now + CLOSED_TTL);
            state.snapshots.insert(repo.into(), (rows, until));
        }
    }

    #[cfg(test)]
    pub fn expire_cache(&self) {
        for cached in self.state.lock().unwrap().cache.values_mut() {
            cached.until = UNIX_EPOCH;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    fn response(body: &str) -> Response {
        Response {
            body: body.into(),
            headers: String::new(),
            not_modified: false,
            graphql_rate: None,
        }
    }

    #[test]
    fn cache_coalesces_across_worktrees_and_closed_does_not_poll() {
        let gateway = Arc::new(Gateway::default());
        let calls = Arc::new(AtomicUsize::new(0));
        let workers: Vec<_> = (0..8)
            .map(|index| {
                let gateway = gateway.clone();
                let calls = calls.clone();
                std::thread::spawn(move || {
                    gateway
                        .run(
                            Path::new(&format!("worktree{index}")),
                            &["pr", "view", "42", "--repo", "owner/repo"],
                            |_, _| {
                                calls.fetch_add(1, Ordering::SeqCst);
                                std::thread::sleep(Duration::from_millis(20));
                                Ok(response(r#"{"state":"CLOSED"}"#))
                            },
                        )
                        .unwrap()
                })
            })
            .collect();
        for worker in workers {
            worker.join().unwrap();
        }
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert_eq!(
            gateway
                .state
                .lock()
                .unwrap()
                .cache
                .values()
                .next()
                .unwrap()
                .until
                .duration_since(SystemTime::now())
                .unwrap()
                .as_secs(),
            86399
        );
    }

    #[test]
    fn etag_304_and_low_budget_preserve_last_data_until_reset() {
        let gateway = Gateway::default();
        let args = ["api", "repos/owner/repo/issues"];
        gateway
            .run(Path::new("."), &args, |_, _| {
                Ok(Response {
                    headers: "ETag: fixture\nx-ratelimit-remaining: 4000\nx-ratelimit-limit: 5000"
                        .into(),
                    ..response("[]")
                })
            })
            .unwrap();
        gateway
            .state
            .lock()
            .unwrap()
            .cache
            .values_mut()
            .next()
            .unwrap()
            .until = UNIX_EPOCH;
        assert_eq!(gateway.run(Path::new("."), &args, |_, etag| {
            assert_eq!(etag, Some("fixture"));
            Ok(Response { headers: "x-ratelimit-remaining: 400\nx-ratelimit-limit: 5000\nx-ratelimit-reset: 4070908800".into(), not_modified: true, ..response("") })
        }).unwrap(), "[]");
        gateway
            .state
            .lock()
            .unwrap()
            .cache
            .values_mut()
            .next()
            .unwrap()
            .until = UNIX_EPOCH;
        assert_eq!(
            gateway
                .run(Path::new("."), &args, |_, _| panic!(
                    "low budget must not poll"
                ))
                .unwrap(),
            "[]"
        );
        assert_eq!(gateway.budget().status, "low");
        gateway.state.lock().unwrap().resources.clear();
        gateway
            .run(Path::new("."), &args, |_, _| Ok(response("[1]")))
            .unwrap();
    }

    #[test]
    fn exhausted_is_sanitized_and_blocks_writes_without_stale_success() {
        let gateway = Gateway::default();
        let error = gateway
            .run(Path::new("."), &["pr", "view", "42"], |_, _| {
                Err("GraphQL: API rate limit already exceeded for user ID 17301927".into())
            })
            .unwrap_err();
        assert_eq!(error, LIMITED_MESSAGE);
        assert!(gateway
            .run(Path::new("."), &["pr", "close", "42"], |_, _| panic!(
                "exhausted write"
            ))
            .is_err());
    }

    #[test]
    fn graphql_cost_and_rest_headers_are_observed() {
        let gateway = Gateway::default();
        gateway.run(Path::new("."), &["api", "graphql"], |_, _| Ok(response(
            r#"{"data":{"rateLimit":{"remaining":4997,"limit":5000,"cost":3,"resetAt":"2099-01-01T00:00:00Z"}}}"#))).unwrap();
        let budget = gateway.budget();
        assert_eq!(budget.points, 3);
        assert_eq!(budget.remaining, Some(4997));
        assert_eq!(budget.paths["api graphql"].calls, 1);
    }

    #[test]
    fn mutation_flag_forms_are_never_cached() {
        for args in [
            vec!["api", "repos/o/r", "--method=PATCH"],
            vec!["api", "repos/o/r", "-XPOST"],
            vec!["api", "repos/o/r", "--field=body=hello"],
            vec!["api", "repos/o/r", "-fbody=hello"],
            vec!["api", "graphql", "-f", "query=mutation{closePullRequest}"],
            vec!["pr", "edit", "42"],
        ] {
            assert!(!read(&args), "{args:?}");
            let gateway = Gateway::default();
            let mut calls = 0;
            for _ in 0..2 {
                gateway
                    .run(Path::new("."), &args, |_, _| {
                        calls += 1;
                        Ok(response("done"))
                    })
                    .unwrap();
            }
            assert_eq!(calls, 2);
        }
    }

    #[test]
    fn restrictive_resource_and_failed_request_win_until_their_reset() {
        let mut state = State::default();
        state.observe("graphql", &response(r#"{"data":{"rateLimit":{"remaining":0,"limit":5000,"cost":1,"resetAt":"2099-01-01T00:00:00Z"}}}"#));
        state.observe("core", &Response { headers:"x-ratelimit-resource: core\nx-ratelimit-remaining: 5000\nx-ratelimit-limit: 5000\nx-ratelimit-reset: 4070908800".into(), ..response("[]") });
        assert_eq!(state.budget.status, "exhausted");
        assert_eq!(state.budget.resource.as_deref(), Some("graphql"));
        state.forced_pause = Some(SystemTime::now() + Duration::from_secs(3600));
        state.observe("graphql", &response(r#"{"data":{"rateLimit":{"remaining":5000,"limit":5000,"resetAt":"2099-01-01T00:00:00Z"}}}"#));
        assert_eq!(state.budget.status, "exhausted");
        state.forced_pause = Some(UNIX_EPOCH);
        state.expire_budget(SystemTime::now());
        assert_eq!(state.budget.status, "ok");
    }
}
