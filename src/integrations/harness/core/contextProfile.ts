import type { Session } from "../../../features/sessions/model/session";
import type { HarnessEvent } from "./types";

export type ContextProfile = Pick<Session, "harness" | "model" | "modelSettings">;
export type ProviderBindingProfile = Pick<Session, "harness" | "providerAccountId">;

export function sameContextProfile(session: ContextProfile, profile: ContextProfile): boolean {
  return session.harness === profile.harness && session.model === profile.model &&
    Object.keys({ ...session.modelSettings, ...profile.modelSettings })
      .every(key => session.modelSettings[key] === profile.modelSettings[key]);
}

/** Keep the emitting profile attached until queued events reach the reducer. */
export function bindTurnContextProfile(session: ContextProfile & ProviderBindingProfile): (event: HarnessEvent) => HarnessEvent {
  const bindingProfile: ProviderBindingProfile = { harness: session.harness, providerAccountId: session.providerAccountId };
  let profile: ContextProfile = {
    harness: session.harness,
    model: session.model,
    modelSettings: { ...session.modelSettings },
  };
  return event => {
    if (event.type === "session.providerBound") return { ...event, bindingProfile };
    if (event.type !== "context" && event.type !== "session.configChanged") return event;
    const tagged = { ...event, contextProfile: profile };
    if (event.type === "session.configChanged") {
      profile = {
        ...profile,
        ...(event.model ? { model: event.model } : {}),
        ...(event.modelSettings ? { modelSettings: { ...profile.modelSettings, ...event.modelSettings } } : {}),
      };
    }
    return tagged;
  };
}
