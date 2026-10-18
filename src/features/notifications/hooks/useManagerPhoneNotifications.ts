import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ManagerAttention } from "../../orchestration/model/projectManager";

export function useManagerPhoneNotifications(
  items: readonly ManagerAttention[],
) {
  const seen = useRef(new Set<string>());
  useEffect(() => {
    for (const item of items) {
      if (item.kind === "reply") continue;
      const identity = `${item.key}:${item.kind}:${item.notificationId ?? ""}`;
      if (seen.current.has(identity)) continue;
      seen.current.add(identity);
      if (seen.current.size > 500)
        seen.current.delete(seen.current.values().next().value!);
      // Native delivery owns durable dedupe, bounded retries and redacted status.
      void invoke("ntfy_send", { eventId: identity, kind: item.kind }).catch(
        () => {},
      );
    }
  }, [items]);
}
