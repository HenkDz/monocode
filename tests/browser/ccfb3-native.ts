import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
// @ts-expect-error source-bound guard provided by the startup Vite plugin
export { confirmReload } from "virtual:ccfb3-reload-guard";

const params = new URLSearchParams(location.search);
const mode = params.get("boot");
const calls: { command: string; args: unknown }[] = [];
mockWindows("main");
mockIPC(
  (command, args) => {
    calls.push({ command, args });
    if (command === "plugin:window|is_maximized") return false;
    if (command === "plugin:dialog|message")
      return window.confirm(String(args.message)) ? "Reload" : "No";
    return null;
  },
  { shouldMockEvents: true },
);
Object.assign(window, { ccfb3Calls: calls });
if (mode === "slow" || mode === "never") {
  const NativeObserver = PerformanceObserver;
  window.PerformanceObserver = class extends NativeObserver {
    constructor(callback: PerformanceObserverCallback) {
      super((list, observer) => {
        if (mode === "slow")
          window.setTimeout(() => callback(list, observer), 700);
      });
    }
  };
}
if (mode === "unsupported")
  Object.defineProperty(PerformanceObserver, "supportedEntryTypes", {
    value: [],
  });

export function loadBootWorkspace() {
  const attempts = Number(sessionStorage.getItem("ccfb3-attempts") ?? 0) + 1;
  sessionStorage.setItem("ccfb3-attempts", String(attempts));
  if (mode === "reject" && attempts === 1)
    return Promise.reject(new Error("Synthetic boot IPC rejection"));
  if (mode === "hung") return new Promise<never>(() => {});
  return Promise.resolve({
    windowTransfer: null,
    resumed: null,
    history: [],
    historyCwd: null,
  });
}
export const homeDir = () => Promise.resolve("C:/synthetic");
export const setHomeDir = () => {};
export const initSounds = () => {};
export const initializeProviderBinaryPaths = () => Promise.resolve();
export const consumeInstalledUpdate = () => null;
export const abortQuit = () => {};
export const askQuitConfirmation = () => {};
export const commitQuit = () => {};
export const reportQuitPoll = () => {};
