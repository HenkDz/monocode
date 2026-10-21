declare module "virtual:ccux2-app" {
  import type { ComponentProps } from "react";
  import type { TitleBar } from "../../src/app/shell/TitleBar";
  import type { Worktree } from "../../src/features/source-control/model/worktrees";
  export type AppRoutes = {
    onOpenMono(id: string): Promise<void>;
    onSelectHistorySession(id: string): Promise<void>;
    onSelectProjectWorktree(project: string, tree: Worktree): void;
    onNewWorktreeSession(project: string, tree: Worktree): void;
    onSelectTitleTab(id: string): void;
    closeViewTab(id: string): void;
    onRunProjectScript(project: string, path: string, name: string): Promise<void>;
    onOpenTeamMap(scope?: string): void;
    onOpenSearch(): void;
    onOpenInbox(): void;
    onOpenNotes(): void;
    onOpenAutomations(): void;
    onToggleRightPanel(): void;
    readTitle(): { title: ComponentProps<typeof TitleBar>; contextVisible: boolean; global: boolean };
  };
  export function bindCCUX2<T extends object>(ports: T): T & AppRoutes;
}
