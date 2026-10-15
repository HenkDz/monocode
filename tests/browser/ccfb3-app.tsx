import { WindowControls } from "../../src/app/shell/WindowControls";

export default function SyntheticWorkspace() {
  return (
    <div className="flex h-screen flex-col text-content">
      <header
        className="flex h-10 shrink-0 justify-end border-b border-stroke"
        data-tauri-drag-region="deep"
      >
        <WindowControls />
      </header>
      <main className="flex flex-1 flex-col items-center justify-center gap-4">
        <h1 className="text-2xl">Synthetic workspace ready</h1>
        <p>Startup recovery fixture · native IPC is mocked</p>
        <button
          type="button"
          className="rounded border border-stroke px-4 py-2"
          onClick={(event) => {
            event.currentTarget.textContent = "Workspace responds";
          }}
        >
          Check workspace
        </button>
      </main>
    </div>
  );
}
