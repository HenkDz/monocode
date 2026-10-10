import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

type Settings = {
  enabled: boolean;
  server: string;
  topic: string;
  hasToken: boolean;
  supported: boolean;
  status: string;
};

export function NtfySettings() {
  const [settings, setSettings] = useState<Settings>();
  const [token, setToken] = useState("");
  const [clearToken, setClearToken] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    let disposed = false;
    void invoke<Settings>("ntfy_settings")
      .then((value) => {
        if (!disposed) setSettings(value);
      })
      .catch(() => {
        if (!disposed)
          setError("Phone notification settings could not be loaded.");
      });
    const timer = window.setInterval(() => {
      if (!document.hidden)
        void invoke<Settings>("ntfy_settings")
          .then((value) => {
            if (!disposed)
              setSettings(
                (current) => current && { ...current, status: value.status },
              );
          })
          .catch(() => {});
    }, 10_000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, []);
  const update = (patch: Partial<Settings>) => {
    setSettings((value) => value && { ...value, ...patch });
    setDirty(true);
  };
  const run = async (test: boolean) => {
    if (!settings || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      if (test)
        await invoke("ntfy_send", {
          eventId: crypto.randomUUID(),
          kind: "test",
        });
      else {
        await invoke("ntfy_save", {
          config: {
            enabled: settings.enabled,
            server: settings.server.trim(),
            topic: settings.topic.trim(),
            token,
          },
          clearToken,
        });
        setToken("");
        setClearToken(false);
        setDirty(false);
      }
      setSettings(await invoke<Settings>("ntfy_settings"));
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  };
  const input =
    "mt-1 w-full rounded-md border border-stroke bg-background-base px-3 py-2 text-content focus-visible:outline-accent";
  return (
    <section
      className="my-6 space-y-3 font-sans text-sm"
      aria-label="Phone notifications"
    >
      <h3 className="font-medium text-content">Phone notifications</h3>
      <p className="text-xs leading-relaxed text-content/60">
        Opt in to ntfy alerts when Manager needs a decision or has a PR ready.
        Messages contain only the event type. No remote replies or approvals.
      </p>
      {settings && (
        <fieldset
          disabled={busy || !settings.supported}
          className="space-y-3 disabled:opacity-60"
        >
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={settings.enabled}
              onChange={(event) => update({ enabled: event.target.checked })}
            />{" "}
            Enable phone notifications
          </label>
          <label className="block">
            HTTPS ntfy server
            <input
              type="url"
              className={input}
              placeholder="https://ntfy.sh"
              value={settings.server}
              onChange={(event) => update({ server: event.target.value })}
            />
          </label>
          <label className="block">
            Topic
            <input
              className={input}
              autoComplete="off"
              value={settings.topic}
              onChange={(event) => update({ topic: event.target.value })}
            />
          </label>
          <label className="block">
            Access token (optional)
            <input
              type="password"
              autoComplete="new-password"
              className={input}
              value={token}
              placeholder={
                settings.hasToken
                  ? "Saved securely; leave blank to keep"
                  : "Stored in Windows Credential Manager"
              }
              onChange={(event) => {
                setToken(event.target.value);
                setDirty(true);
              }}
            />
          </label>
          {settings.hasToken && (
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={clearToken}
                onChange={(event) => {
                  setClearToken(event.target.checked);
                  setDirty(true);
                }}
              />{" "}
              Remove saved token
            </label>
          )}
          <p className="text-xs text-content/60">
            Subscribe to this server and topic in the ntfy phone app. Use an
            access-controlled topic or a long random name: public topics can be
            read by anyone who knows the name. Changing servers clears the saved
            token.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={!dirty}
              onClick={() => void run(false)}
              className="rounded-md bg-content px-3 py-1.5 text-background-base disabled:opacity-40"
            >
              Save
            </button>
            <button
              type="button"
              disabled={dirty || !settings.enabled}
              onClick={() => void run(true)}
              className="rounded-md border border-stroke px-3 py-1.5 disabled:opacity-40"
            >
              Send test
            </button>
          </div>
        </fieldset>
      )}
      {settings && !settings.supported && (
        <p>
          Secure phone notifications currently require Windows Credential
          Manager.
        </p>
      )}
      <p role="status" className="text-xs text-content/65">
        {busy ? "Working…" : settings?.status}
      </p>
      {error && (
        <p role="alert" className="text-xs text-red-500">
          {error}
        </p>
      )}
    </section>
  );
}
