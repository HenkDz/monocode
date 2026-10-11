import { useState, useSyncExternalStore } from "react";
import type { Mono } from "../model/mono";
import { crewMessages, crewMessagesSnapshot, subscribeCrewMessages } from "../model/monoCrewEvents";
import { WorkbenchDrawer } from "./WorkbenchDrawer";

export function ManagerWorkbenchNote({ member }: { member: Mono }) {
  useSyncExternalStore(subscribeCrewMessages, crewMessagesSnapshot);
  const [opened, setOpened] = useState(false);
  const message = crewMessages().filter((item) => item.senderId === member.reportsTo && item.recipientId === member.id)
    .sort((a, b) => b.at - a.at)[0];
  if (!message) return null;
  return <aside className="cc7u-manager-note" aria-label="Latest Manager message">
    <h3>From Manager</h3>
    <p>{message.text}</p>
    <button type="button" onClick={() => setOpened(true)}>Read team message →</button>
    {opened && <WorkbenchDrawer title={message.topic || "From Manager"} onClose={() => setOpened(false)}>
      <p className="whitespace-pre-wrap break-words">{message.text}</p>
      <time className="mt-4 block text-content/60" dateTime={new Date(message.at).toISOString()}>{new Date(message.at).toLocaleString()}</time>
    </WorkbenchDrawer>}
  </aside>;
}
