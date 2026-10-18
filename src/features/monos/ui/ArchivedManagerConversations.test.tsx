// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import {
  ArchivedManagerConversation,
  ArchivedManagerConversations,
} from "./ArchivedManagerConversations";
import { getSession } from "../../sessions/data/sessionStore";
vi.mock("../../sessions/data/sessionStore", () => ({
  listSessionsByProject: vi.fn(async () => [
    {
      id: "project-manager-old",
      cwd: "/app",
      archived: true,
      title: "Previous Manager",
    },
    {
      id: "ordinary",
      cwd: "/app",
      archived: true,
      title: "Other conversation",
    },
  ]),
  getSession: vi.fn(async () => ({
    id: "project-manager-old",
    cwd: "/app",
    title: "Previous Manager",
    blocks: [
      { id: "unique", role: "user", text: "Unique retained conversation" },
    ],
  })),
}));
vi.mock("./MonoActivityPanel", () => ({
  MonoActivityContent: ({ blocks }: { blocks: { text: string }[] }) =>
    createElement("div", null, blocks.map((block) => block.text).join("\n")),
}));

it("opens archived unique Manager history from Details without a composer or adoption", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  function Details() {
    const [selected, setSelected] = useState("");
    return selected
      ? createElement(ArchivedManagerConversation, {
          id: selected,
          onBack: () => setSelected(""),
        })
      : createElement(ArchivedManagerConversations, {
          project: "/app",
          onOpen: setSelected,
        });
  }
  await act(async () => root.render(createElement(Details)));
  expect(host.textContent).toContain("Archived conversations");
  expect(host.textContent).not.toContain("Other conversation");
  await act(async () =>
    [...host.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "Previous Manager")!
      .click(),
  );
  expect(getSession).toHaveBeenCalledWith("project-manager-old");
  expect(host.textContent).toContain("Unique retained conversation");
  expect(host.querySelector("textarea")).toBeNull();
  expect(
    host.querySelector("[data-archived-manager-conversation]"),
  ).not.toBeNull();
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
