// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TeamMapHeaderAction, TeamMapNav, useTeamMap } from "./navigation";

vi.mock("@tauri-apps/api/core", async original => ({
  ...await original<object>(), invoke: vi.fn(async () => null),
}));

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

function Routes() {
  const map = useTeamMap();
  return <>
    <aside><TeamMapNav onOpen={() => map.show()} /></aside>
    <main>
      {map.open ? <section aria-label="Team map view">
        {map.scope ?? "org"}<button onClick={map.close}>Back</button>
      </section> : <>
        <p>Previous chat</p>
        <TeamMapHeaderAction monoId="manager" onOpen={map.show} />
        <TeamMapHeaderAction monoId="boss" onOpen={map.show} />
      </>}
    </main>
  </>;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.setItem("monocode:mono-roster", JSON.stringify([
    { id: "manager", role: "manager", projects: ["/app"] },
    { id: "boss", role: "orchestrator", projects: ["/app"] },
  ]));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove(); localStorage.clear(); vi.unstubAllGlobals();
});

it("uses the same main view for sidebar, Manager and Orchestrator and returns to chat", async () => {
  await act(async () => root.render(<Routes />));
  const back = async () => act(async () => host.querySelector<HTMLButtonElement>('main button')!.click());
  await act(async () => host.querySelector<HTMLButtonElement>('aside button')!.click());
  expect(host.querySelector("aside")).not.toBeNull();
  expect(host.querySelector('main section')?.textContent).toBe("orgBack");
  expect(host.querySelector("main p")).toBeNull();
  await back();
  expect(host.querySelector("main p")?.textContent).toBe("Previous chat");
  await act(async () => host.querySelectorAll<HTMLButtonElement>('main button')[0].click());
  expect(host.querySelector('main section')?.textContent).toBe("managerBack");
  await back();
  await act(async () => host.querySelectorAll<HTMLButtonElement>('main button')[1].click());
  expect(host.querySelector('main section')?.textContent).toBe("orgBack");
});
