import { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { mockIPC } from "@tauri-apps/api/mocks";
// @ts-expect-error supplied by the fixture's source-bound Vite plugin
import expressions from "virtual:ccfb2-shell";
import { UsageFooter } from "../../src/app/shell/UsageFooter";
import { setCachedRateLimits } from "../../src/features/providers/model/rateLimitsCache";
import { selectUsageDashboard } from "../../src/features/providers/model/usageDashboard";
import { providerAccounts } from "../../src/features/providers/model/providerAccounts";
import type { ProviderRateLimits } from "../../src/features/providers/model/rateLimits";
import { UsageDashboard, USAGE_DASHBOARD_SCOPE } from "../../src/features/providers/ui/UsageDashboard";
import { useTeamMap } from "../../src/features/teamMap/navigation";
import "../../src/styles/index.css";

document.documentElement.classList.toggle("theme-light", new URLSearchParams(location.search).get("theme") === "light");
mockIPC(() => null);
const now = Date.now();
const limits: ProviderRateLimits = {
  provider: "codex", status: "ok", error: null, updatedAt: now,
  session: { usedPercent: 42, windowMinutes: 300, resetsAt: now + 2 * 3_600_000 },
  weekly: { usedPercent: 81, windowMinutes: 10_080, resetsAt: now + 2 * 86_400_000 },
  monthly: null, resetCredits: { availableCount: 2, credits: [] },
};
setCachedRateLimits("codex", "default", limits);
const snapshot = selectUsageDashboard({
  roster: [], runs: [], sessions: [], now,
  accounts: providerAccounts("codex"), usage: { "codex:default": limits },
});

function Fixture() {
  const teamMap = useTeamMap();
  const onOpenUsage = new Function("onOpenTeamMap", "USAGE_DASHBOARD_SCOPE", `return ${expressions.footerOpen};`)(teamMap.show, USAGE_DASHBOARD_SCOPE);
  const surface = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (teamMap.open) surface.current?.querySelector<HTMLHeadingElement>("h1")?.focus();
  }, [teamMap.open]);
  return <div className="flex h-screen flex-col bg-background-base text-content">
    <main ref={surface} className="min-h-0 flex-1 overflow-auto">
      {teamMap.open && teamMap.scope === USAGE_DASHBOARD_SCOPE
        ? <UsageDashboard snapshot={snapshot} />
        : <p className="p-6 text-sm text-content/40">Synthetic footer fixture</p>}
    </main>
    <UsageFooter providers={["codex"]} onOpenUsage={onOpenUsage} />
  </div>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
