import type { Clock, ShellHost, StateStore } from "./ports";
import type { CoreState, PaneId, Session, SessionId } from "./state";

export type Effect = { type: "closeWindow"; sessionId: SessionId };

export interface CoreDependencies {
  shellHost: ShellHost;
  stateStore: StateStore;
  clock: Clock;
  homeDirectory: string;
}

export interface Core {
  start(): void;
  state(): CoreState;
  onEffect(listener: (effect: Effect) => void): void;
}

export function createCore({ shellHost, clock, homeDirectory }: CoreDependencies): Core {
  let state: CoreState = { sessions: [] };
  const effectListeners: ((effect: Effect) => void)[] = [];

  function emit(effect: Effect) {
    for (const listener of effectListeners) listener(effect);
  }

  // Closing the last Pane closes its Tab; closing the last Tab closes the Session.
  function closePane(paneId: PaneId) {
    const closedSessions: SessionId[] = [];
    state = {
      sessions: state.sessions.map((session) => {
        if (!session.tabs.some((tab) => tab.panes.some((pane) => pane.id === paneId))) return session;
        const tabs = session.tabs
          .map((tab) => ({ ...tab, panes: tab.panes.filter((pane) => pane.id !== paneId) }))
          .filter((tab) => tab.panes.length > 0);
        if (tabs.length > 0) return { ...session, tabs };
        closedSessions.push(session.id);
        return { ...session, status: "closed", tabs } satisfies Session;
      }),
    };
    for (const sessionId of closedSessions) emit({ type: "closeWindow", sessionId });
  }

  shellHost.subscribe((event) => {
    if (event.type === "shellExited") closePane(event.paneId);
  });

  return {
    start() {
      const now = clock.now();
      const pane = { id: "pane-1", workingDirectory: homeDirectory };
      state = {
        sessions: [
          {
            id: "session-1",
            status: "open",
            createdAt: now,
            lastUsedAt: now,
            tabs: [{ id: "tab-1", panes: [pane] }],
          },
        ],
      };
      shellHost.start(pane.id, { workingDirectory: pane.workingDirectory });
    },
    state: () => state,
    onEffect(listener) {
      effectListeners.push(listener);
    },
  };
}
