export type SessionId = string;
export type TabId = string;
export type PaneId = string;

export interface CoreState {
  sessions: Session[];
}

export interface Session {
  id: SessionId;
  status: "open" | "closed";
  createdAt: number;
  lastUsedAt: number;
  tabs: Tab[];
}

export interface Tab {
  id: TabId;
  panes: Pane[];
}

export interface Pane {
  id: PaneId;
  workingDirectory: string;
}
