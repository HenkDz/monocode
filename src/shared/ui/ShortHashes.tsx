import { useState } from "react";
import { copyText } from "../../platform/tauri/clipboard";

/** Coordination prose only; approval commands and source code stay verbatim. */
export function ShortHashes({ text }: { text: string }) {
  const [notice, setNotice] = useState("");
  return <>{text.split(/\b([0-9a-f]{40,64})\b/gi).map((part, index) => /^[0-9a-f]{40,64}$/i.test(part)
    ? <button key={index} type="button" title={part} aria-label={`Copy commit ${part.slice(0, 7)}`} className="rounded font-mono underline decoration-dotted focus-visible:outline-accent" onClick={() => { void copyText(part).then(() => setNotice("Commit copied"), () => setNotice("Couldn’t copy. Open details to select the full commit.")); }}>{part.slice(0, 7)}</button> : part)}
    {notice && <span role="status" className="sr-only">{notice}</span>}</>;
}
