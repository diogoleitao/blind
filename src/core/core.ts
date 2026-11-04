import type { Clock, ShellHost, StateStore } from "./ports";
import type { CoreState, Pane, PaneId, Session, SessionId, Tab, TabId } from "./state";

export type Effect = { type: "closeWindow"; sessionId: SessionId } | { type: "showApp" } | { type: "hideApp" };

export interface CoreDependencies {
  shellHost: ShellHost;
  stateStore: StateStore;
  clock: Clock;
  homeDirectory: string;
}

export interface Core {
  start(): void;
  state(): CoreState;
  hotkeyPressed(): void;
  // Blind stopped being the active app, e.g. because another app was clicked.
  focusLost(): void;
  // Opens a Tab after the others, in the current Pane's working directory, and focuses it.
  newTab(sessionId: SessionId): void;
  // Focuses the Tab at a zero-based position, if there is one.
  focusTab(sessionId: SessionId, position: number): void;
  // Both wrap around between the first and last Tab.
  focusPreviousTab(sessionId: SessionId): void;
  focusNextTab(sessionId: SessionId): void;
  // The focused Pane's running program, or its working directory's folder name while the Shell is idle.
  tabTitle(tabId: TabId): string | undefined;
  onEffect(listener: (effect: Effect) => void): void;
  onStateChange(listener: (state: CoreState) => void): void;
}

export function createCore({ shellHost, clock, homeDirectory }: CoreDependencies): Core {
  let state: CoreState = { sessions: [] };
  // Whether the app is on screen. Not part of the snapshot: it says nothing about Sessions.
  let appShown = true;
  const effectListeners: ((effect: Effect) => void)[] = [];
  const stateListeners: ((state: CoreState) => void)[] = [];
  let lastId = 0;

  function nextId(kind: "session" | "tab" | "pane") {
    lastId += 1;
    return `${kind}-${lastId}`;
  }

  function emit(effect: Effect) {
    for (const listener of effectListeners) listener(effect);
  }

  function setState(next: CoreState) {
    state = next;
    for (const listener of stateListeners) listener(state);
  }

  function findSession(sessionId: SessionId) {
    return state.sessions.find((session) => session.id === sessionId);
  }

  // Leaves the state, and its listeners, alone when `update` returns the Session unchanged.
  function updateSession(sessionId: SessionId, update: (session: Session) => Session) {
    const session = findSession(sessionId);
    if (!session) return;
    const updated = update(session);
    if (updated === session) return;
    setState({ sessions: state.sessions.map((candidate) => (candidate === session ? updated : candidate)) });
  }

  function updatePane(paneId: PaneId, update: (pane: Pane) => Pane) {
    setState({
      sessions: state.sessions.map((session) => ({
        ...session,
        tabs: session.tabs.map((tab) => ({
          ...tab,
          panes: tab.panes.map((pane) => (pane.id === paneId ? update(pane) : pane)),
        })),
      })),
    });
  }

  // Each Tab holds a single Pane until Panes can be split, so it is always the focused one.
  function focusedPane(tab: Tab) {
    return tab.panes[0];
  }

  function focusedTabPosition(session: Session) {
    return session.tabs.findIndex((tab) => tab.id === session.focusedTabId);
  }

  // The last segment of a path, or "/" for the filesystem root.
  function folderName(directory: string) {
    return directory.split("/").filter(Boolean).at(-1) ?? "/";
  }

  // A new Tab with one Pane, whose Shell starts in `workingDirectory`.
  function openTab(workingDirectory: string): Tab {
    const pane = { id: nextId("pane"), workingDirectory };
    shellHost.start(pane.id, { workingDirectory });
    return { id: nextId("tab"), panes: [pane] };
  }

  function focusTabBy(sessionId: SessionId, offset: number) {
    updateSession(sessionId, (session) => {
      const count = session.tabs.length;
      if (count === 0) return session;
      const position = focusedTabPosition(session);
      return { ...session, focusedTabId: session.tabs[(position + offset + count) % count].id };
    });
  }

  // Closing the last Pane closes its Tab; closing the last Tab closes the Session.
  // When the focused Tab closes, the Tab that takes its place is focused, or the new last Tab.
  function closePane(paneId: PaneId) {
    const closedSessions: SessionId[] = [];
    setState({
      sessions: state.sessions.map((session) => {
        if (!session.tabs.some((tab) => tab.panes.some((pane) => pane.id === paneId))) return session;
        const tabs = session.tabs
          .map((tab) => ({ ...tab, panes: tab.panes.filter((pane) => pane.id !== paneId) }))
          .filter((tab) => tab.panes.length > 0);
        if (tabs.length > 0) {
          if (tabs.some((tab) => tab.id === session.focusedTabId)) return { ...session, tabs };
          const position = focusedTabPosition(session);
          return { ...session, tabs, focusedTabId: tabs[Math.min(position, tabs.length - 1)].id };
        }
        closedSessions.push(session.id);
        return { ...session, status: "closed", tabs, focusedTabId: undefined } satisfies Session;
      }),
    });
    for (const sessionId of closedSessions) emit({ type: "closeWindow", sessionId });
  }

  shellHost.subscribe((event) => {
    if (event.type === "shellExited") closePane(event.paneId);
    if (event.type === "workingDirectoryChanged") {
      updatePane(event.paneId, (pane) => ({ ...pane, workingDirectory: event.workingDirectory }));
    }
    if (event.type === "runningProgramChanged") {
      updatePane(event.paneId, (pane) => ({ ...pane, runningProgram: event.runningProgram }));
    }
  });

  return {
    start() {
      const now = clock.now();
      const tab = openTab(homeDirectory);
      setState({
        sessions: [
          {
            id: nextId("session"),
            status: "open",
            createdAt: now,
            lastUsedAt: now,
            tabs: [tab],
            focusedTabId: tab.id,
          },
        ],
      });
    },
    state: () => state,
    hotkeyPressed() {
      appShown = !appShown;
      emit({ type: appShown ? "showApp" : "hideApp" });
    },
    focusLost() {
      if (!appShown) return;
      appShown = false;
      emit({ type: "hideApp" });
    },
    newTab(sessionId) {
      const session = findSession(sessionId);
      const focusedTab = session?.tabs.find((tab) => tab.id === session.focusedTabId);
      if (!focusedTab) return;
      const tab = openTab(focusedPane(focusedTab).workingDirectory);
      updateSession(sessionId, (session) => ({ ...session, tabs: [...session.tabs, tab], focusedTabId: tab.id }));
    },
    focusTab(sessionId, position) {
      updateSession(sessionId, (session) => {
        const tab = session.tabs[position];
        return tab && tab.id !== session.focusedTabId ? { ...session, focusedTabId: tab.id } : session;
      });
    },
    focusPreviousTab: (sessionId) => focusTabBy(sessionId, -1),
    focusNextTab: (sessionId) => focusTabBy(sessionId, 1),
    tabTitle(tabId) {
      const tab = state.sessions.flatMap((session) => session.tabs).find((candidate) => candidate.id === tabId);
      if (!tab) return undefined;
      const pane = focusedPane(tab);
      return pane.runningProgram ?? folderName(pane.workingDirectory);
    },
    onEffect(listener) {
      effectListeners.push(listener);
    },
    onStateChange(listener) {
      stateListeners.push(listener);
    },
  };
}
