import {
  type FocusDirection,
  neighbourOf,
  type PaneRect,
  paneRects,
  removePane,
  replacePane,
  successorOf,
} from "./layout";
import type { Clock, ShellHost, StateStore } from "./ports";
import type { CoreState, Pane, PaneId, Session, SessionId, SplitDirection, Tab, TabId } from "./state";

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
  // Splits the focused Pane in two, starting the new half's Shell in the same working directory, and focuses it.
  splitPane(sessionId: SessionId, direction: SplitDirection): void;
  // Closes the focused Pane and stops its Shell, following the same chain as the Shell exiting.
  closePane(sessionId: SessionId): void;
  // Both move through the focused Tab's Panes in layout order, wrapping around between the first and last.
  focusPreviousPane(sessionId: SessionId): void;
  focusNextPane(sessionId: SessionId): void;
  // Moves to the Pane across the focused Pane's edge, if there is one.
  focusPaneInDirection(sessionId: SessionId, direction: FocusDirection): void;
  // Focuses a Pane within its Tab, e.g. because it was clicked.
  focusPane(paneId: PaneId): void;
  // The focused Pane's running program, or its working directory's folder name while the Shell is idle.
  tabTitle(tabId: TabId): string | undefined;
  // Where each of the Tab's Panes sits, in layout order.
  paneRects(tabId: TabId): PaneRect[];
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

  function findTab(tabId: TabId) {
    return state.sessions.flatMap((session) => session.tabs).find((tab) => tab.id === tabId);
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

  function focusedTab(session: Session) {
    return session.tabs.find((tab) => tab.id === session.focusedTabId);
  }

  function focusedPane(tab: Tab) {
    return tab.panes.find((pane) => pane.id === tab.focusedPaneId)!;
  }

  // Like `updateSession`, leaves the state alone when `update` returns the Tab unchanged.
  function updateFocusedTab(sessionId: SessionId, update: (tab: Tab) => Tab) {
    updateSession(sessionId, (session) => {
      const tab = focusedTab(session);
      if (!tab) return session;
      const updated = update(tab);
      if (updated === tab) return session;
      return { ...session, tabs: session.tabs.map((candidate) => (candidate === tab ? updated : candidate)) };
    });
  }

  function withFocusedPane(tab: Tab, paneId: PaneId): Tab {
    return paneId === tab.focusedPaneId ? tab : { ...tab, focusedPaneId: paneId };
  }

  function hasPane(tab: Tab, paneId: PaneId) {
    return tab.panes.some((pane) => pane.id === paneId);
  }

  function findSessionWithPane(paneId: PaneId) {
    return state.sessions.find((session) => session.tabs.some((tab) => hasPane(tab, paneId)));
  }

  function focusPaneBy(sessionId: SessionId, offset: number) {
    updateFocusedTab(sessionId, (tab) => {
      const count = tab.panes.length;
      const position = tab.panes.findIndex((pane) => pane.id === tab.focusedPaneId);
      return withFocusedPane(tab, tab.panes[(position + offset + count) % count].id);
    });
  }

  function focusedTabPosition(session: Session) {
    return session.tabs.findIndex((tab) => tab.id === session.focusedTabId);
  }

  // The last segment of a path, or "/" for the filesystem root.
  function folderName(directory: string) {
    return directory.split("/").filter(Boolean).at(-1) ?? "/";
  }

  // A new Pane whose Shell starts in `workingDirectory`.
  function openPane(workingDirectory: string): Pane {
    const pane = { id: nextId("pane"), workingDirectory };
    shellHost.start(pane.id, { workingDirectory });
    return pane;
  }

  function openTab(workingDirectory: string): Tab {
    const pane = openPane(workingDirectory);
    return { id: nextId("tab"), panes: [pane], layout: { type: "pane", paneId: pane.id }, focusedPaneId: pane.id };
  }

  function focusTabBy(sessionId: SessionId, offset: number) {
    updateSession(sessionId, (session) => {
      const count = session.tabs.length;
      if (count === 0) return session;
      const position = focusedTabPosition(session);
      return { ...session, focusedTabId: session.tabs[(position + offset + count) % count].id };
    });
  }

  // The Pane's sibling fills its space; closing the last Pane closes its Tab, and closing the last Tab closes the Session.
  // When the focused Pane closes, the Pane nearest to it in that sibling is focused. When the focused Tab closes, the
  // Tab that takes its place is focused, or the new last Tab.
  function removePaneFromSession(paneId: PaneId) {
    const session = findSessionWithPane(paneId);
    if (!session) return;
    const tabs = session.tabs.flatMap((tab): Tab[] => {
      if (!hasPane(tab, paneId)) return [tab];
      const layout = removePane(tab.layout, paneId);
      if (!layout) return [];
      const focusedPaneId = tab.focusedPaneId === paneId ? successorOf(tab.layout, paneId)! : tab.focusedPaneId;
      return [{ ...tab, panes: tab.panes.filter((pane) => pane.id !== paneId), layout, focusedPaneId }];
    });
    updateSession(session.id, (session) => {
      if (tabs.length === 0) return { ...session, status: "closed", tabs, focusedTabId: undefined };
      if (tabs.some((tab) => tab.id === session.focusedTabId)) return { ...session, tabs };
      const position = focusedTabPosition(session);
      return { ...session, tabs, focusedTabId: tabs[Math.min(position, tabs.length - 1)].id };
    });
    if (tabs.length === 0) emit({ type: "closeWindow", sessionId: session.id });
  }

  shellHost.subscribe((event) => {
    if (event.type === "shellExited") removePaneFromSession(event.paneId);
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
      const current = session && focusedTab(session);
      if (!current) return;
      const tab = openTab(focusedPane(current).workingDirectory);
      updateSession(sessionId, (session) => ({ ...session, tabs: [...session.tabs, tab], focusedTabId: tab.id }));
    },
    splitPane(sessionId, direction) {
      updateFocusedTab(sessionId, (tab) => {
        const current = focusedPane(tab);
        const pane = openPane(current.workingDirectory);
        return {
          ...tab,
          panes: tab.panes.flatMap((candidate) => (candidate === current ? [current, pane] : [candidate])),
          layout: replacePane(tab.layout, current.id, {
            type: "split",
            direction,
            first: { type: "pane", paneId: current.id },
            second: { type: "pane", paneId: pane.id },
          }),
          focusedPaneId: pane.id,
        };
      });
    },
    closePane(sessionId) {
      const session = findSession(sessionId);
      const tab = session && focusedTab(session);
      if (!tab) return;
      removePaneFromSession(tab.focusedPaneId);
      shellHost.stop(tab.focusedPaneId);
    },
    focusPreviousPane: (sessionId) => focusPaneBy(sessionId, -1),
    focusNextPane: (sessionId) => focusPaneBy(sessionId, 1),
    focusPaneInDirection(sessionId, direction) {
      updateFocusedTab(sessionId, (tab) => {
        const neighbour = neighbourOf(tab.layout, tab.focusedPaneId, direction);
        return neighbour ? withFocusedPane(tab, neighbour) : tab;
      });
    },
    focusPane(paneId) {
      const session = findSessionWithPane(paneId);
      if (!session) return;
      updateSession(session.id, (session) => ({
        ...session,
        tabs: session.tabs.map((tab) => (hasPane(tab, paneId) ? withFocusedPane(tab, paneId) : tab)),
      }));
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
      const tab = findTab(tabId);
      if (!tab) return undefined;
      const pane = focusedPane(tab);
      return pane.runningProgram ?? folderName(pane.workingDirectory);
    },
    paneRects(tabId) {
      const tab = findTab(tabId);
      return tab ? paneRects(tab.layout) : [];
    },
    onEffect(listener) {
      effectListeners.push(listener);
    },
    onStateChange(listener) {
      stateListeners.push(listener);
    },
  };
}
