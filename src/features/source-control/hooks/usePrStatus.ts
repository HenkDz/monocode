import { useCallback, useEffect, useState } from "react";
import {
  gitPrStatus,
  subscribeGitChanged,
  type GitPr,
} from "../../../platform/tauri/fs";
import { pathKey } from "../../../shared/lib/paths";

const cache = new Map<string, GitPr | null>();

export function usePrStatus(
  cwd: string,
  branch: string | null | undefined,
  enabled = true,
): { pr: GitPr | null; reload: () => void } {
  const key = `${pathKey(cwd)}\n${branch ?? ""}`;
  const active = enabled && !!cwd && cwd !== "~" && !!branch;
  const [result, setResult] = useState(() => ({
    key,
    pr: cache.get(key) ?? null,
  }));
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let request = 0;
    const load = async () => {
      const current = ++request;
      const pr = await gitPrStatus(cwd).catch(() => null);
      if (cancelled || current !== request) return;
      cache.set(key, pr);
      setResult({ key, pr });
    };
    const resume = () => {
      if (!document.hidden) void load();
    };
    void load();
    const unsubscribe = subscribeGitChanged(resume);
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      cancelled = true;
      unsubscribe();
      window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [active, cwd, key, nonce]);

  return {
    pr: active
      ? result.key === key
        ? result.pr
        : (cache.get(key) ?? null)
      : null,
    reload,
  };
}
