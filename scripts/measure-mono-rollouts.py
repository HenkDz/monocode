#!/usr/bin/env python3
"""Measure copied Codex rollouts without changing the rollouts or MonoCode DB.

Usage: python scripts/measure-mono-rollouts.py SESSIONS_DIR COPIED_DB
       python scripts/measure-mono-rollouts.py MONO_SESSIONS COPIED_DB --extra-sessions WORKER_SESSIONS
       python scripts/measure-mono-rollouts.py --self-test

Directories are searched recursively. Roles come from Mono org charts and DB
worker/manager links; unmatched sessions remain Unknown. Character counts are
per-turn response messages (AGENTS.md excluded), not tokenizer estimates.
Payload counts strip the same Mono context tags as evidence/payload.py.
Recorded call latency is used when present. The separately labelled estimate
is (completed turn duration - union of tool intervals) / recorded calls; it
includes compaction, orchestration and logging overhead, not just model time.
Dispatch gaps use persisted dispatch/goal timestamps and the recipient's next
turn. Worker turn end -> next lead turn is an upper bound, not proof that
the lead turn was triggered by that report. Missing recipients are counted.
The DB and any WAL are copied to a disposable scratch directory and opened
mode=ro with query_only enabled. SQLite may create scratch SHM coordination
files; no supplied DB, WAL, SHM or rollout is modified. Use a stable DB copy.
"""

import argparse
from collections import defaultdict
from contextlib import closing, contextmanager
from dataclasses import dataclass, field
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import re
import shutil
import sqlite3
from statistics import median
import tempfile


CONTEXT_TAGS = re.compile(
    r"<(monocode_context|monocode_worktrees|monocode_project_manager|"
    r"monocode_cli_input|monocode_assignment|environment_context|org_chart)>"
    r".*?</\1>", re.S,
)
ORG_CHART = re.compile(r"<org_chart>\s*")
ROLES = {"orchestrator": "Grand Orch", "manager": "Manager", "member": "Worker"}


def timestamp(value):
    if isinstance(value, (float, int)):
        try:
            return datetime.fromtimestamp(value / 1000, timezone.utc)
        except (ValueError, OverflowError, OSError):
            return None
    if not isinstance(value, str):
        return None
    try:
        result = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return result.replace(tzinfo=timezone.utc) if result.tzinfo is None else result
    except ValueError:
        return None


def text_of(content):
    if isinstance(content, str):
        return content
    return "".join(item["text"] for item in content or []
                   if isinstance(item, dict) and isinstance(item.get("text"), str))


def org_role(text):
    for match in ORG_CHART.finditer(text):
        try:
            chart, _ = json.JSONDecoder().raw_decode(text, match.end())
            if isinstance(chart, dict) and chart.get("role") in ROLES:
                return ROLES[chart["role"]]
        except ValueError:
            pass
    return None


@contextmanager
def open_db(path):
    path = Path(path).resolve()
    if not path.is_file():
        raise ValueError(f"Database does not exist: {path}")
    with tempfile.TemporaryDirectory(prefix="mono-rollout-db-") as directory:
        snapshot = Path(directory) / path.name
        # SQLite mode=ro can write source SHM; a scratch copy also keeps WAL data visible.
        sources = [path.with_name(path.name + suffix) for suffix in ("", "-wal")]
        before = {source: (source.stat().st_size, source.stat().st_mtime_ns)
                  if source.is_file() else None for source in sources}
        for source in sources:
            if source.is_file():
                shutil.copyfile(source, snapshot.with_name(source.name))
        after = {source: (source.stat().st_size, source.stat().st_mtime_ns)
                 if source.is_file() else None for source in sources}
        if before != after:
            raise ValueError("Database changed during snapshot; supply a stable copied DB")
        with closing(sqlite3.connect(snapshot.as_uri() + "?mode=ro", uri=True)) as db:
            db.execute("PRAGMA query_only = ON")
            yield db


def read_db(path):
    with open_db(path) as db:
        tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        sessions = dict(db.execute("SELECT id, provider_session_id FROM sessions"))
        workers = dict(db.execute("SELECT session_id, lead_id FROM orchestration_workers")) if "orchestration_workers" in tables else {}
        runs = []
        if "orchestration_runs" in tables:
            for lead, raw in db.execute("SELECT lead_id, state FROM orchestration_runs"):
                try:
                    state = json.loads(raw)
                    if isinstance(state, dict):
                        runs.append((lead, state))
                except (ValueError, TypeError):
                    pass
    owners = {state["ownerMonoId"]: state["ownerSessionId"] for _, state in runs
              if state.get("ownerMonoId") and state.get("ownerSessionId")}
    roles = {sessions[sid]: "Worker" for sid in workers if sessions.get(sid)}
    dispatches = []
    for lead, state in runs:
        owner = state.get("ownerSessionId", lead)
        if state.get("projectManager") and sessions.get(owner):
            roles[sessions[owner]] = "Manager"
        for dispatch in state.get("dispatches") or []:
            if isinstance(dispatch, dict):
                dispatches.append(("dispatch -> Worker", sessions.get(dispatch.get("sessionId")),
                                   timestamp(dispatch.get("startedAt"))))
        if lead.startswith("mono-goals:"):
            sid = sessions.get(lead.removeprefix("mono-goals:"))
            if sid:
                roles[sid] = "Grand Orch"
            for goal in state.get("goals") or []:
                if isinstance(goal, dict):
                    manager = owners.get(goal.get("managerId"), goal.get("managerId"))
                    dispatches.append(("goal -> Manager", sessions.get(manager), timestamp(goal.get("createdAt"))))
    parents = {sessions[child]: sessions.get(owners.get(parent, parent))
               for child, parent in workers.items() if sessions.get(child)}
    return roles, parents, dispatches


@dataclass
class Turn:
    start: datetime | None
    end: datetime | None = None
    duration_ms: float | None = None
    ttft_ms: float | None = None
    user: list = field(default_factory=list)
    developer: list = field(default_factory=list)
    calls: list = field(default_factory=list)
    fallback_calls: list = field(default_factory=list)
    tools: list = field(default_factory=list)
    pending: dict = field(default_factory=dict)
    compacted: bool = False

    def duration(self):
        if not self.end:
            return None
        if isinstance(self.duration_ms, (int, float)):
            return self.duration_ms / 1000
        return (self.end - self.start).total_seconds() if self.start else None

    def tool_seconds(self):
        intervals = sorted((max(start, self.start) if self.start else start,
                            min(end, self.end) if self.end else end)
                           for start, end in self.tools if end >= start)
        total, previous_end = 0, None
        for start, end in intervals:
            if end > start:
                total += max(0, (end - max(start, previous_end or start)).total_seconds())
                previous_end = max(end, previous_end or end)
        return total


def read_rollout(path):
    turns, current, buffered = [], None, []
    session_id, role, base_chars, malformed = path.stem, "Unknown", 0, 0
    compactions, compact_events = defaultdict(set), defaultdict(set)
    last_usage_total = None
    with path.open(encoding="utf-8") as stream:
        for line_number, line in enumerate(stream):
            try:
                record = json.loads(line)
                if not isinstance(record, dict):
                    raise ValueError("not an object")
            except ValueError:
                malformed += 1
                continue
            kind, payload = record.get("type"), record.get("payload") or {}
            if not isinstance(payload, dict):
                continue
            subtype, at = payload.get("type"), timestamp(record.get("timestamp"))
            if kind == "session_meta":
                session_id = payload.get("id") or session_id
                base = payload.get("base_instructions") or {}
                base_chars = len(base.get("text", "")) if isinstance(base, dict) else len(str(base))
            elif kind == "event_msg" and subtype == "task_started":
                current = Turn(at)
                turns.append(current)
                for message_role, text in buffered:
                    getattr(current, message_role).append(text)
                buffered.clear()
            elif kind == "turn_context" and current is None:
                current = Turn(at)
                turns.append(current)
                for message_role, text in buffered:
                    getattr(current, message_role).append(text)
                buffered.clear()
            elif kind == "response_item" and subtype == "message":
                text = text_of(payload.get("content"))
                message_role = payload.get("role")
                if message_role in ("user", "developer"):
                    role = org_role(text) or role
                if message_role in ("user", "developer") and not (message_role == "user" and text.lstrip().startswith("# AGENTS.md")):
                    if current is None:
                        buffered.append((message_role, text))
                    else:
                        getattr(current, message_role).append(text)
            elif kind == "compacted" or (kind == "event_msg" and subtype == "context_compacted"):
                identity = payload.get("compaction_id") or payload.get("id") or record.get("id")
                if not isinstance(identity, (str, int)):
                    identity = None
                (compactions if kind == "compacted" else compact_events)[at if at is not None else line_number].add(identity)
                if current:
                    current.compacted = True
            elif current is not None:
                if kind == "token_usage_record":
                    usage = payload.get("usage") or {}
                    if isinstance(usage, dict):
                        current.calls.append((usage, payload.get("duration_ms")))
                elif kind == "event_msg" and subtype == "token_count":
                    info = payload.get("info") or {}
                    total = info.get("total_token_usage")
                    usage = info.get("last_token_usage")
                    if isinstance(usage, dict) and total != last_usage_total:
                        current.fallback_calls.append((usage, None))
                        last_usage_total = total
                elif kind == "response_item" and subtype in ("custom_tool_call", "function_call"):
                    if at and payload.get("call_id"):
                        current.pending[payload["call_id"]] = at
                elif kind == "response_item" and subtype in ("custom_tool_call_output", "function_call_output"):
                    start = current.pending.pop(payload.get("call_id"), None)
                    if start and at:
                        current.tools.append((start, at))
                elif kind == "event_msg" and subtype == "task_complete":
                    current.end, current.duration_ms = at, payload.get("duration_ms")
                    current.ttft_ms = payload.get("time_to_first_token_ms")
                    current = None
    for turn in turns:
        if not turn.calls:
            turn.calls = turn.fallback_calls
    for at, identities in compactions.items():
        events = compact_events.get(at, set())
        for identity in sorted(identities, key=lambda item: item is None):
            if identity in events:
                events.remove(identity)
            elif identity is not None and None in events:
                events.remove(None)
            elif identity is None and events:
                events.pop()
    return {"id": session_id, "role": role, "base": base_chars, "turns": turns,
            "compactions": sum(map(len, compactions.values())) + sum(map(len, compact_events.values())),
            "malformed": malformed}


def collect(directories, db_path):
    roles, parents, dispatches = read_db(db_path)
    paths = set()
    for directory in directories:
        directory = Path(directory).resolve()
        if not directory.is_dir():
            raise ValueError(f"Sessions directory does not exist: {directory}")
        paths.update(directory.rglob("*.jsonl"))
    sessions, duplicates = {}, 0
    for path in sorted(paths):
        session = read_rollout(path)
        if not session["turns"]:
            continue
        if session["id"] in sessions:
            duplicates += 1
            if len(session["turns"]) <= len(sessions[session["id"]]["turns"]):
                continue
        if session["role"] == "Unknown":
            session["role"] = roles.get(session["id"], "Unknown")
        sessions[session["id"]] = session
    gaps, unmatched = defaultdict(list), 0
    for kind, recipient, at in dispatches:
        starts = [turn.start for turn in sessions.get(recipient, {}).get("turns", [])
                  if turn.start and at and turn.start >= at]
        if starts:
            gaps[kind].append((min(starts) - at).total_seconds())
        else:
            unmatched += 1
    for child, parent in parents.items():
        starts = [turn.start for turn in sessions.get(parent, {}).get("turns", []) if turn.start]
        for turn in sessions.get(child, {}).get("turns", []):
            next_starts = [start for start in starts if turn.end and start >= turn.end]
            if next_starts:
                gaps["Worker turn end -> next lead turn (upper bound)"].append((min(next_starts) - turn.end).total_seconds())
    return sessions, gaps, {"files": len(paths), "duplicate_sessions": duplicates,
                            "unmatched_dispatches": unmatched}


def stats(values):
    if not values:
        return "n/a"
    values = sorted(values)
    return f"{median(values):.1f}/{values[math.ceil(len(values) * .95) - 1]:.1f}/{max(values):.1f}"


def report(sessions, gaps, counts):
    groups = defaultdict(list)
    for session in sessions.values():
        groups[session["role"]].append(session)
    print(f"Files={counts['files']} sessions={len(sessions)} duplicate_sessions={counts['duplicate_sessions']} "
          f"malformed_lines={sum(session['malformed'] for session in sessions.values())}")
    print("Context characters: median/p95/max; user excludes AGENTS.md; payload strips Mono context tags.")
    print("Role | turns | base/session | developer/turn | user/turn | payload/turn | boilerplate share")
    for role, group in sorted(groups.items()):
        turns = [turn for session in group for turn in session["turns"]]
        users = [sum(map(len, turn.user)) for turn in turns]
        payloads = [sum(len(CONTEXT_TAGS.sub("", text).strip()) for text in turn.user) for turn in turns]
        share = 100 * (1 - sum(payloads) / sum(users)) if sum(users) else 0
        print(f"{role} | {len(turns)} | {stats([session['base'] for session in group])} | "
              f"{stats([sum(map(len, turn.developer)) for turn in turns])} | {stats(users)} | {stats(payloads)} | {share:.1f}%")
    print("\nLatency seconds: median/p95/max; recorded-call samples and estimates are separate.")
    print("Role | calls | input tokens/call | recorded call s (n) | turn-minus-tools/call s (n) | turn s")
    for role, group in sorted(groups.items()):
        turns = [turn for session in group for turn in session["turns"]]
        calls = [call for turn in turns for call in turn.calls]
        recorded = [duration / 1000 for _, duration in calls if isinstance(duration, (int, float)) and duration >= 0]
        estimates = [max(0, turn.duration() - turn.tool_seconds()) / len(turn.calls)
                     for turn in turns if turn.calls and turn.duration() is not None]
        durations = [turn.duration() for turn in turns if turn.duration() is not None]
        print(f"{role} | {len(calls)} | {stats([usage.get('input_tokens', 0) for usage, _ in calls])} | "
              f"{stats(recorded)} ({len(recorded)}) | {stats(estimates)} ({len(estimates)}) | {stats(durations)}")
    print("\nCompactions: compacted records and context_compacted events deduplicated by identity and timestamp.")
    print("Role | compactions | affected turns | compacted TTFT s | other TTFT s")
    for role, group in sorted(groups.items()):
        turns = [turn for session in group for turn in session["turns"]]
        compacted = [turn.ttft_ms / 1000 for turn in turns if turn.compacted and isinstance(turn.ttft_ms, (int, float))]
        plain = [turn.ttft_ms / 1000 for turn in turns if not turn.compacted and isinstance(turn.ttft_ms, (int, float))]
        print(f"{role} | {sum(session['compactions'] for session in group)} | {sum(turn.compacted for turn in turns)} | {stats(compacted)} | {stats(plain)}")
    print("\nHand-off gaps seconds: median/p95/max; DB timestamps -> next observed recipient turn.")
    for kind, samples in sorted(gaps.items()):
        print(f"{kind} | n={len(samples)} | {stats(samples)}")
    if not gaps:
        print("No correlated hand-off samples.")
    print(f"Unmatched persisted dispatches/goals={counts['unmatched_dispatches']}; gaps can include queueing or unrelated turns.")


def self_test():
    import io
    from contextlib import redirect_stdout

    with tempfile.TemporaryDirectory(prefix="mono-rollout-measure-") as directory:
        root = Path(directory)
        db_path = root / "copied.db"
        with closing(sqlite3.connect(db_path)) as db:
            db.executescript("CREATE TABLE sessions(id TEXT, provider_session_id TEXT);"
                             "CREATE TABLE orchestration_workers(session_id TEXT, lead_id TEXT);"
                             "CREATE TABLE orchestration_runs(lead_id TEXT, state TEXT);")
            db.executemany("INSERT INTO sessions VALUES (?,?)", [("go", "go-rollout"), ("mgr", "mgr-rollout"), ("worker", "worker-rollout")])
            db.execute("INSERT INTO orchestration_workers VALUES ('worker','manager-mono')")
            db.executemany("INSERT INTO orchestration_runs VALUES (?,?)", [
                ("manager-mono", json.dumps({"ownerMonoId": "manager-mono", "ownerSessionId": "mgr", "projectManager": True,
                                             "dispatches": [{"sessionId": "worker", "startedAt": 1767225630000}]})),
                ("mono-goals:go", json.dumps({"goals": [{"managerId": "manager-mono", "createdAt": 1767225600000}]})),
            ])
            db.commit()
        digest = hashlib.sha256(db_path.read_bytes()).digest()
        modified = db_path.stat().st_mtime_ns

        def fixture(name, start, end, role=None, calls=True, compact=False):
            at = lambda seconds: f"2026-01-01T00:{seconds // 60:02d}:{seconds % 60:02d}Z"
            records = [{"type": "session_meta", "payload": {"id": name, "base_instructions": {"text": "base"}}}]
            def add(kind, seconds, **payload):
                records.append({"type": kind, "timestamp": at(seconds), "payload": payload})
            add("event_msg", start, type="task_started")
            add("response_item", start, type="message", role="user", content=[{"text": "# AGENTS.md secret-fixture-data"}])
            chart = '<org_chart>{"role":"' + role + '"}</org_chart>' if role else ""
            add("response_item", start, type="message", role="user", content=[{"text": chart + "你好 task"}])
            add("response_item", start, type="message", role="developer", content=[{"text": "rules"}])
            add("response_item", start + 1, type="function_call", call_id="a")
            add("response_item", start + 2, type="function_call", call_id="b")
            add("response_item", start + 5, type="function_call_output", call_id="a")
            add("response_item", start + 6, type="function_call_output", call_id="b")
            if calls:
                add("token_usage_record", start + 7, usage={"input_tokens": 123}, duration_ms=2000)
                add("token_usage_record", start + 8, usage={"input_tokens": 456})
            else:
                for offset in (7, 8):
                    add("event_msg", start + offset, type="token_count", info={"last_token_usage": {"input_tokens": 789}, "total_token_usage": {"input_tokens": 789}})
            if compact:
                add("compacted", start + 9, message="summary")
                add("event_msg", start + 9, type="context_compacted")
            add("event_msg", end, type="task_complete", duration_ms=(end - start) * 1000, time_to_first_token_ms=8000)
            path = root / "sessions" / name / "2026" / "01" / f"rollout-{name}.jsonl"
            path.parent.mkdir(parents=True)
            path.write_text("\n".join(map(json.dumps, records)) + "\nmalformed\n", encoding="utf-8")
            return path

        fixture("go-rollout", 0, 10, "orchestrator")
        manager_path = fixture("mgr-rollout", 10, 30, compact=True)
        # A later lead turn receives the completed worker report.
        with manager_path.open("a", encoding="utf-8") as stream:
            for subtype, at in (("task_started", 70), ("task_complete", 80)):
                stream.write(json.dumps({"type": "event_msg", "timestamp": f"2026-01-01T00:01:{at - 60:02d}Z", "payload": {"type": subtype}}) + "\n")
        fixture("worker-rollout", 40, 60)
        fixture("unknown-rollout", 5, 20, calls=False)
        sessions, gaps, counts = collect([root / "sessions", root / "sessions" / "go-rollout"], db_path)
        assert len(sessions) == 4 and counts["files"] == 4
        assert {session["role"] for session in sessions.values()} == {"Grand Orch", "Manager", "Worker", "Unknown"}
        worker = sessions["worker-rollout"]["turns"][0]
        assert worker.tool_seconds() == 5, worker.tools
        assert sum(map(len, worker.user)) == len("你好 task")
        assert len(sessions["unknown-rollout"]["turns"][0].calls) == 1
        assert sessions["mgr-rollout"]["compactions"] == 1
        assert gaps["dispatch -> Worker"] == [10] and gaps["goal -> Manager"] == [10]
        assert gaps["Worker turn end -> next lead turn (upper bound)"] == [10]

        def record(kind, at=None, **payload):
            return {"type": kind, "timestamp": at, "payload": payload}

        mixed_path = root / "mixed-history.jsonl"
        older_usage = {"last_token_usage": {"input_tokens": 123}, "total_token_usage": {"input_tokens": 123}}
        newer_usage = {"last_token_usage": {"input_tokens": 999}, "total_token_usage": {"input_tokens": 1122}}
        mixed_records = [
            record("event_msg", "2026-10-09T10:00:00Z", type="task_started"),
            record("event_msg", "2026-10-09T10:00:01Z", type="token_count", info=older_usage),
            record("event_msg", "2026-10-09T10:00:01Z", type="token_count", info=older_usage),
            record("event_msg", "2026-10-09T10:00:02Z", type="context_compacted"),
            record("event_msg", "2026-10-09T10:00:03Z", type="task_complete"),
            record("event_msg", "2026-10-11T10:00:00Z", type="task_started"),
            record("event_msg", "2026-10-11T10:00:01Z", type="token_count", info=newer_usage),
            record("token_usage_record", "2026-10-11T10:00:01Z", usage={"input_tokens": 456}, duration_ms=1000),
            record("compacted", "2026-10-11T10:00:02Z", message="synthetic summary"),
            record("event_msg", "2026-10-11T10:00:02Z", type="context_compacted"),
            record("event_msg", "2026-10-11T10:00:03Z", type="task_complete"),
        ]
        mixed_path.write_text("\n".join(map(json.dumps, mixed_records)) + "\n", encoding="utf-8")
        mixed = read_rollout(mixed_path)
        assert [len(turn.calls) for turn in mixed["turns"]] == [1, 1]
        assert mixed["turns"][0].calls == [({"input_tokens": 123}, None)]
        assert mixed["turns"][1].calls == [({"input_tokens": 456}, 1000)]
        assert mixed["compactions"] == 2 and sum(turn.compacted for turn in mixed["turns"]) == 2

        compaction_path = root / "compaction-identities.jsonl"
        compaction_records = [
            record("compacted", "2026-10-11T10:00:00Z", compaction_id="a"),
            record("event_msg", "2026-10-11T10:00:00Z", type="context_compacted", compaction_id="a"),
            record("compacted", "2026-10-11T10:00:00Z", id="b"),
            record("event_msg", "2026-10-11T10:00:00Z", type="context_compacted", id="b"),
            record("compacted", "2026-10-11T10:00:01Z", compaction_id="a"),
            record("compacted", "2026-10-11T10:00:02Z"),
            record("event_msg", "2026-10-11T10:00:02+00:00", type="context_compacted"),
            record("compacted"),
            record("event_msg", type="context_compacted"),
            record("compacted", "2026-10-11T10:00:03Z", compaction_id="c"),
            record("event_msg", "2026-10-11T10:00:03Z", type="context_compacted"),
            record("compacted", "2026-10-11T10:00:04Z", id=["unsupported-identity"]),
            record("event_msg", "2026-10-11T10:00:04Z", type="context_compacted", compaction_id="d"),
        ]
        compaction_path.write_text("\n".join(map(json.dumps, compaction_records)) + "\n", encoding="utf-8")
        assert read_rollout(compaction_path)["compactions"] == 8

        output = io.StringIO()
        with redirect_stdout(output):
            report(sessions, gaps, counts)
        assert "secret-fixture-data" not in output.getvalue()
        assert "7.5/7.5/7.5" in output.getvalue(), output.getvalue()
        with open_db(db_path) as db:
            try:
                db.execute("DELETE FROM sessions")
            except sqlite3.OperationalError:
                pass
            else:
                raise AssertionError("Read-only connection accepted a write")
        assert hashlib.sha256(db_path.read_bytes()).digest() == digest
        assert db_path.stat().st_mtime_ns == modified
        with closing(sqlite3.connect(db_path)) as writer:
            writer.execute("PRAGMA journal_mode = WAL")
            writer.execute("INSERT INTO sessions VALUES ('uncheckpointed','wal-only')")
            writer.commit()
            sources = [db_path.with_name(db_path.name + suffix) for suffix in ("", "-wal", "-shm")]
            before = [(hashlib.sha256(source.read_bytes()).digest(), source.stat().st_mtime_ns) for source in sources]
            with open_db(db_path) as db:
                assert db.execute("SELECT provider_session_id FROM sessions WHERE id='uncheckpointed'").fetchone() == ("wal-only",)
            after = [(hashlib.sha256(source.read_bytes()).digest(), source.stat().st_mtime_ns) for source in sources]
            assert before == after, "Analyzer modified a supplied DB/WAL/SHM file"
        print("Self-test passed: nested trees, role mapping, unknown roles, Unicode/context counts, "
              "overlapping tools, per-turn mixed-history token fallback, detailed usage precedence, "
              "token fallback deduplication, compaction identity/timestamp deduplication, "
              "10s hand-offs, no prompt disclosure, denied writes, WAL visibility, and unchanged DB/WAL/SHM.")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("sessions_dir", nargs="?")
    parser.add_argument("db", nargs="?")
    parser.add_argument("--extra-sessions", action="append", default=[], metavar="DIRECTORY")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return
    if not args.sessions_dir or not args.db:
        parser.error("SESSIONS_DIR and COPIED_DB are required (or use --self-test)")
    try:
        sessions, gaps, counts = collect([args.sessions_dir, *args.extra_sessions], args.db)
        if not sessions:
            raise ValueError("No Codex turns found in the supplied sessions directories")
        report(sessions, gaps, counts)
    except (OSError, sqlite3.Error, ValueError) as error:
        parser.exit(1, f"Error: {error}\n")


if __name__ == "__main__":
    main()
