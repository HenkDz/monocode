declare module "virtual:ccux2-app" {
  export type AppRoutes = {
    onOpenMono(id: string): Promise<void>;
    onSelectHistorySession(id: string): Promise<void>;
    onSelectProjectWorktree(project: string, tree: import("../../src/features/source-control/model/worktrees").Worktree): void;
    onNewWorktreeSession(project: string, tree: import("../../src/features/source-control/model/worktrees").Worktree): void;
    onSelectTitleTab(id: string): void;
    closeViewTab(id: string): void;
    onRunProjectScript(project: string, path: string, name: string): Promise<void>;
    onOpenTeamMap(scope?: string): void;
    onOpenSearch(): void;
    onOpenInbox(): void;
    onOpenNotes(): void;
    onOpenAutomations(): void;
    onToggleRightPanel(): void;
    readTitle(): { title: import("react").ComponentProps<typeof import("../../src/app/shell/TitleBar").TitleBar>; contextVisible: boolean; global: boolean };
  };
  export function bindCCUX2<T extends object>(ports: T): T & AppRoutes;
}
