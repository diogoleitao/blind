export type SessionId = string;
export type TabId = string;
export type PaneId = string;

export interface CoreState {
  sessions: Session[];
  // Absent while there are no Open Sessions.
  currentSessionId?: SessionId;
}

export interface Session {
  id: SessionId;
  // Absent for an Unnamed Session.
  name?: string;
  // The N in an Unnamed Session's `Session N (<dir>)` label, kept until the Session is named.
  labelNumber?: number;
  status: "open" | "closed";
  createdAt: number;
  lastUsedAt: number;
  tabs: Tab[];
  // Absent once the Session has no Tabs.
  focusedTabId?: TabId;
}

export interface Tab {
  id: TabId;
  // In layout order: left to right and top to bottom through the splits.
  panes: Pane[];
  layout: Layout;
  focusedPaneId: PaneId;
}

// A vertical split puts its halves side by side with a vertical divider; a horizontal one stacks them.
export type SplitDirection = "vertical" | "horizontal";

// A Tab's Panes as a tree of splits, each dividing its space in half.
export type Layout =
  | { type: "pane"; paneId: PaneId }
  | { type: "split"; direction: SplitDirection; first: Layout; second: Layout };

export interface Pane {
  id: PaneId;
  workingDirectory: string;
  // Absent while the Shell is idle at a prompt.
  runningProgram?: string;
}
