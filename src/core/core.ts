import {
  type FocusDirection,
  neighbourOf,
  type PaneRect,
  paneRects,
  removePane,
  replacePane,
  successorOf,
} from "./layout";
import { defaultSettings, parseConfig, type Settings } from "./config";
import { fuzzyScore } from "./fuzzy";
import { type BoundAction, type KeyPress, matchesShortcut } from "./key-bindings";
import type { Clock, SavedScrollback, ShellHost, Snapshot, StateStore } from "./ports";
import { capScrollback } from "./scrollback";
import {
  type CoreState,
  idsIn,
  type Pane,
  type PaneId,
  type Session,
  type SessionId,
  type SplitDirection,
  type Tab,
  type TabId,
} from "./state";

export type Effect =
  | { type: "closeWindow"; sessionId: SessionId }
  // Fades the app in with the Session visible.
  | { type: "showApp"; sessionId: SessionId }
  // Fades the app in with the Command Palette on its own, over no Session.
  | { type: "showPalette" }
  // Opens the Command Palette over the Session's window.
  | { type: "openPalette"; sessionId: SessionId }
  | { type: "hideApp" }
  // Makes the Session the visible one in place of the Session shown before, without a fade.
  | { type: "showSession"; sessionId: SessionId }
  // Asks the user whether to quit, answered with `quitConfirmed`.
  | { type: "confirmQuit" }
  // Asks the user for the Session's name, offering `suggestion`, answered with `renameSession`.
  | { type: "askSessionName"; sessionId: SessionId; suggestion: string }
  // Asks the user whether to delete the Session, answered with `deleteConfirmed`.
  | { type: "confirmDelete"; sessionId: SessionId }
  // Asks the user for the title of a Tab in the Session, offering `suggestion`, answered with `renameTab`.
  | { type: "askTabTitle"; sessionId: SessionId; tabId: TabId; suggestion: string }
  // Opens the config file for editing.
  | { type: "openSettings" }
  // Everything is saved; the app can exit.
  | { type: "quit" }
  // Tells the user the config file's settings that were rejected and fell back to their defaults.
  | { type: "settingsRejected"; settings: string[] }
  // Tells the user the config file couldn't be read as a JSON object, comments allowed, so the settings stay as they were.
  | { type: "configUnreadable" };

// Every app action, in the order the Command Palette offers them, by its label.
const paletteActionLabels = {
  newSession: "New Session",
  renameSession: "Rename Session",
  setSessionRoot: "Set Session Root",
  clearSessionRoot: "Clear Session Root",
  closeSession: "Close Session",
  deleteSession: "Delete Session",
  newTab: "New Tab",
  renameTab: "Rename Tab",
  clearTabTitle: "Clear Tab Title",
  splitPaneVertically: "Split Pane Vertically",
  splitPaneHorizontally: "Split Pane Horizontally",
  closePane: "Close Pane",
  nextSession: "Next Session",
  previousSession: "Previous Session",
  nextTab: "Next Tab",
  previousTab: "Previous Tab",
  nextPane: "Next Pane",
  previousPane: "Previous Pane",
  focusPaneLeft: "Focus Pane Left",
  focusPaneRight: "Focus Pane Right",
  focusPaneUp: "Focus Pane Above",
  focusPaneDown: "Focus Pane Below",
  openSettings: "Open Settings",
  quit: "Quit Blind",
} as const;

export type PaletteAction = keyof typeof paletteActionLabels;

// One entry the Command Palette offers.
export type PaletteResult =
  | { type: "session"; sessionId: SessionId; label: string; closed: boolean }
  | { type: "tab"; tabId: TabId; label: string; sessionLabel: string }
  | { type: "pane"; paneId: PaneId; label: string; workingDirectory: string; sessionLabel: string }
  | { type: "action"; action: PaletteAction; label: string };

export interface CoreDependencies {
  shellHost: ShellHost;
  stateStore: StateStore;
  clock: Clock;
  homeDirectory: string;
}

export interface Core {
  start(): void;
  state(): CoreState;
  // With no Open Sessions, shows a new Session or the Command Palette on its own, as the setting says.
  hotkeyPressed(): void;
  // The Command Palette closed without a choice. Shown on its own, with no Current Session, the app hides with it.
  paletteDismissed(): void;
  // Blind stopped being the active app, e.g. because another app was clicked.
  focusLost(): void;
  // Quitting always asks for confirmation first.
  quitRequested(): void;
  // With the Command Palette on its own, the only thing on screen, the app hides once the quit is cancelled.
  quitCancelled(): void;
  quitConfirmed(): void;
  // The config file's text, or undefined without a file. Settings start at their defaults, as without a file. Text that
  // isn't a JSON object, e.g. a save caught halfway through an edit, leaves the settings as they were.
  configChanged(config: string | undefined): void;
  // The config file exists but couldn't be opened; the settings stay as they were.
  configUnreadable(): void;
  settings(): Settings;
  // Opens an Unnamed Session with one Tab at the home directory and makes it the Current Session.
  newSession(): void;
  // Opens a Closed Session again as the Current Session, restoring it as Restore does. One closed through its last Tab
  // gets a fresh Tab at its Root directory, or the home directory without one.
  reopenSession(sessionId: SessionId): void;
  // Gives the Session a name, freeing its label number. A name another Session holds gets the smallest free number from
  // 2, e.g. `api 2`, so names stay unique; a blank name changes nothing.
  renameSession(sessionId: SessionId, name: string): void;
  // Makes the current Pane's working directory the Session's Root directory.
  setSessionRoot(sessionId: SessionId): void;
  clearSessionRoot(sessionId: SessionId): void;
  // Makes an Open Session a Closed Session at once, stopping its Shells and keeping its Tabs and Panes for Restore.
  closeSession(sessionId: SessionId): void;
  // Deleting always asks for confirmation first.
  deleteRequested(sessionId: SessionId): void;
  // Removes the Session, Open or Closed, for good, with its scrollback, stopping its Shells.
  deleteConfirmed(sessionId: SessionId): void;
  // Both move the Current Session through the Open Sessions in cycle order, wrapping around.
  focusPreviousSession(): void;
  focusNextSession(): void;
  // Opens a Tab after the others and focuses it, at the Session's Root directory, or without one, in the current Pane's
  // working directory.
  newTab(sessionId: SessionId): void;
  // Focuses the Tab at a zero-based position, if there is one.
  focusTab(sessionId: SessionId, position: number): void;
  // Both wrap around between the first and last Tab.
  focusPreviousTab(sessionId: SessionId): void;
  focusNextTab(sessionId: SessionId): void;
  // Fixes the Tab's title until it's cleared; a blank title clears it.
  renameTab(tabId: TabId, title: string): void;
  // The Tab's title follows its focused Pane again.
  clearTabTitle(tabId: TabId): void;
  // Splits the focused Pane in two, starting the new half's Shell in the same working directory, and focuses it.
  splitPane(sessionId: SessionId, direction: SplitDirection): void;
  // Closes the focused Pane and stops its Shell, following the same chain as the Shell exiting.
  closePane(sessionId: SessionId): void;
  // Both move through the focused Tab's Panes in layout order, wrapping around between the first and last.
  focusPreviousPane(sessionId: SessionId): void;
  focusNextPane(sessionId: SessionId): void;
  // Moves to the Pane across the focused Pane's edge, if there is one.
  focusPaneInDirection(sessionId: SessionId, direction: FocusDirection): void;
  // Runs the action the key is bound to on the Session whose window it was pressed in, answering whether one was, so
  // the Pane's terminal gets the key only when none was.
  keyPressed(sessionId: SessionId, keyPress: KeyPress): boolean;
  // Focuses a Pane within its Tab, e.g. because it was clicked.
  focusPane(paneId: PaneId): void;
  // The title the Tab was renamed to, or else the focused Pane's running program, or its working directory's folder name
  // while the Shell is idle.
  tabTitle(tabId: TabId): string | undefined;
  // The Session's name, or for an Unnamed Session `Session N (<dir>)` with the focused Pane's working directory.
  sessionLabel(sessionId: SessionId): string | undefined;
  // Every Session, Open or Closed, in the order cycling follows: Unnamed Sessions after the named ones.
  sessionsInCycleOrder(): Session[];
  // What the Command Palette offers for a query: every Session, Open and Closed, the Tabs and Panes of Open Sessions,
  // and every app action. `ss `, `tt ` and `pp ` narrow it to Sessions, Tabs or Panes.
  paletteResults(query: string): PaletteResult[];
  // Jumps to a Session, Tab or Pane, making its Session the Current Session with the Tab or Pane focused and reopening a
  // Closed Session first; or runs an app action on the Current Session.
  choosePaletteResult(result: PaletteResult): void;
  // Where each of the Tab's Panes sits, in layout order.
  paneRects(tabId: TabId): PaneRect[];
  // A Pane's terminal reported its serialized scrollback, which is kept up to its last lines, as many as the scrollback
  // lines setting says, and stamped with the clock's time.
  scrollbackChanged(paneId: PaneId, scrollback: string): void;
  // The Pane's saved scrollback, for its terminal to replay when it opens.
  scrollback(paneId: PaneId): SavedScrollback | undefined;
  onEffect(listener: (effect: Effect) => void): void;
  onStateChange(listener: (state: CoreState) => void): void;
}

export function createCore({ shellHost, stateStore, clock, homeDirectory }: CoreDependencies): Core {
  let state: CoreState = { sessions: [] };
  // Kept out of the state: terminals report it far more often than anything else changes.
  let scrollback: Record<PaneId, SavedScrollback> = {};
  // Whether the app is on screen. Not part of the snapshot: it says nothing about Sessions.
  let appShown = true;
  let settings: Settings = defaultSettings;
  // The Session order taken at the first of a run of consecutive cycle presses; absent outside one.
  let cycleStreak: SessionId[] | undefined;
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

  function save() {
    stateStore.save({ state, scrollback });
  }

  function setState(next: CoreState) {
    state = next;
    save();
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
    setState({ ...state, sessions: state.sessions.map((candidate) => (candidate === session ? updated : candidate)) });
  }

  function updatePane(paneId: PaneId, update: (pane: Pane) => Pane) {
    setState({
      ...state,
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
  function updateTab(tabId: TabId, update: (tab: Tab) => Tab) {
    const session = state.sessions.find((candidate) => candidate.tabs.some((tab) => tab.id === tabId));
    if (!session) return;
    updateSession(session.id, (session) => {
      const tab = session.tabs.find((candidate) => candidate.id === tabId)!;
      const updated = update(tab);
      if (updated === tab) return session;
      return { ...session, tabs: session.tabs.map((candidate) => (candidate === tab ? updated : candidate)) };
    });
  }

  // The Session's focused Tab; absent for an unknown Session or one without Tabs.
  function focusedTabOf(sessionId: SessionId) {
    const session = findSession(sessionId);
    return session && focusedTab(session);
  }

  function updateFocusedTab(sessionId: SessionId, update: (tab: Tab) => Tab) {
    const tab = focusedTabOf(sessionId);
    if (tab) updateTab(tab.id, update);
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

  // Runs the shell setting's program, so a change to it reaches only the Shells started after it.
  function startShell({ id, workingDirectory }: Pane) {
    shellHost.start(id, { workingDirectory, shell: settings.shell });
  }

  // A new Pane whose Shell starts in `workingDirectory`.
  function openPane(workingDirectory: string): Pane {
    const pane = { id: nextId("pane"), workingDirectory };
    startShell(pane);
    return pane;
  }

  // The Session's Panes with a fresh Shell each, in their working directories. Nothing that ran before runs again.
  function restartShells(session: Session): Session {
    return {
      ...session,
      tabs: session.tabs.map((tab) => ({
        ...tab,
        panes: tab.panes.map(({ runningProgram: _stopped, ...pane }) => {
          startShell(pane);
          return pane;
        }),
      })),
    };
  }

  // Brings back the saved Sessions, starting Shells for the Open ones. New ids continue after the saved ones.
  function restore(saved: Snapshot) {
    lastId = Math.max(lastId, ...idsIn(saved.state).map((id) => Number(id.split("-").at(-1))));
    scrollback = saved.scrollback;
    const sessions = saved.state.sessions.map((session) =>
      session.status === "open" ? restartShells(session) : session,
    );
    setState({ ...saved.state, sessions });
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
    const { [paneId]: _dropped, ...kept } = scrollback;
    scrollback = kept;
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
    if (tabs.length > 0) return;
    closeWindow(session.id);
  }

  // When the Session's window was the one on screen, another Open Session takes its place.
  function closeWindow(sessionId: SessionId) {
    emit({ type: "closeWindow", sessionId });
    if (sessionId === state.currentSessionId) replaceCurrentSession();
  }

  function paneIdsOf(session: Session) {
    return session.tabs.flatMap((tab) => tab.panes.map((pane) => pane.id));
  }

  // After the Current Session closes, the most recently used Open Session takes its place; with none left, the app
  // hides.
  function replaceCurrentSession() {
    const open = state.sessions.filter((session) => session.status === "open");
    const next = open.toSorted((a, b) => b.lastUsedAt - a.lastUsedAt)[0];
    if (next) return makeCurrent(next.id);
    setState({ ...state, currentSessionId: undefined });
    if (!appShown) return;
    appShown = false;
    emit({ type: "hideApp" });
  }

  // With the Command Palette on its own, the only thing on screen, the app hides.
  function hideWithNoCurrentSession() {
    if (!appShown || state.currentSessionId !== undefined) return;
    appShown = false;
    emit({ type: "hideApp" });
  }

  // The smallest label number no Unnamed Session holds, starting at 1.
  function freeLabelNumber() {
    const taken = new Set(state.sessions.map((session) => session.labelNumber));
    let number = 1;
    while (taken.has(number)) number += 1;
    return number;
  }

  // The name, or when another Session holds it, the name with the smallest free number from 2, e.g. `api 2`.
  function uniqueName(name: string, sessionId: SessionId) {
    const taken = new Set(state.sessions.filter((session) => session.id !== sessionId).map((session) => session.name));
    if (!taken.has(name)) return name;
    let number = 2;
    while (taken.has(`${name} ${number}`)) number += 1;
    return `${name} ${number}`;
  }

  function openSession(): Session {
    const now = clock.now();
    const tab = openTab(homeDirectory);
    return {
      id: nextId("session"),
      labelNumber: freeLabelNumber(),
      status: "open",
      createdAt: now,
      lastUsedAt: now,
      tabs: [tab],
      focusedTabId: tab.id,
    };
  }

  // Named Sessions before Unnamed Sessions, each group in the cycle order setting's order. Alphabetically, Unnamed
  // Sessions go by label number.
  function compareInCycleOrder(a: Session, b: Session) {
    if ((a.name === undefined) !== (b.name === undefined)) return a.name === undefined ? 1 : -1;
    if (settings.cycleOrder === "recent") return b.lastUsedAt - a.lastUsedAt;
    if (settings.cycleOrder === "created") return a.createdAt - b.createdAt;
    if (a.name !== undefined) return a.name.localeCompare(b.name!, undefined, { numeric: true });
    return a.labelNumber! - b.labelNumber!;
  }

  function sessionsInCycleOrder() {
    return state.sessions.toSorted(compareInCycleOrder);
  }

  // Wraps a command so that it ends any run of cycle presses.
  function command<Args extends unknown[]>(run: (...args: Args) => void) {
    return (...args: Args) => {
      cycleStreak = undefined;
      run(...args);
    };
  }

  // Makes the Session the Current Session, marking it as the most recently used, and swaps it in while the app is shown.
  function makeCurrent(sessionId: SessionId) {
    const now = clock.now();
    setState({
      ...state,
      currentSessionId: sessionId,
      sessions: state.sessions.map((session) => (session.id === sessionId ? { ...session, lastUsedAt: now } : session)),
    });
    if (appShown) emit({ type: "showSession", sessionId });
  }

  // Consecutive presses keep the order from the first one, so that marking each Session as used on the way doesn't
  // re-sort the `recent` order under them.
  function focusSessionBy(offset: number) {
    const order = cycleStreak ?? sessionsInCycleOrder().map((session) => session.id);
    const open = order.filter((sessionId) => findSession(sessionId)?.status === "open");
    if (open.length < 2) return;
    const position = open.indexOf(state.currentSessionId!);
    makeCurrent(open[(position + offset + open.length) % open.length]);
    cycleStreak = order;
  }

  // Opens a new Session as the Current Session.
  function addSession() {
    const session = openSession();
    setState({ sessions: [...state.sessions, session], currentSessionId: session.id });
  }

  // The directory with the home directory shown as `~`.
  function displayDirectory(directory: string) {
    if (directory === homeDirectory) return "~";
    return directory.startsWith(`${homeDirectory}/`) ? `~${directory.slice(homeDirectory.length)}` : directory;
  }

  function labelOf(session: Session) {
    if (session.name !== undefined) return session.name;
    const tab = focusedTab(session);
    const directory = tab ? focusedPane(tab).workingDirectory : homeDirectory;
    return `Session ${session.labelNumber} (${displayDirectory(directory)})`;
  }

  // The Pane's running program, or its working directory's folder name while the Shell is idle.
  function paneTitle(pane: Pane) {
    return pane.runningProgram ?? folderName(pane.workingDirectory);
  }

  function titleOf(tab: Tab) {
    return tab.title ?? paneTitle(focusedPane(tab));
  }

  function clearTitle(tab: Tab): Tab {
    if (tab.title === undefined) return tab;
    const { title: _cleared, ...cleared } = tab;
    return cleared;
  }

  function sessionResults(): PaletteResult[] {
    return sessionsInCycleOrder().map((session) => ({
      type: "session",
      sessionId: session.id,
      label: labelOf(session),
      closed: session.status === "closed",
    }));
  }

  function openSessionsInCycleOrder() {
    return sessionsInCycleOrder().filter((session) => session.status === "open");
  }

  function tabResults(): PaletteResult[] {
    return openSessionsInCycleOrder().flatMap((session) =>
      session.tabs.map((tab) => ({
        type: "tab" as const,
        tabId: tab.id,
        label: titleOf(tab),
        sessionLabel: labelOf(session),
      })),
    );
  }

  function paneResults(): PaletteResult[] {
    return openSessionsInCycleOrder().flatMap((session) =>
      session.tabs.flatMap((tab) =>
        tab.panes.map((pane) => ({
          type: "pane" as const,
          paneId: pane.id,
          label: paneTitle(pane),
          workingDirectory: displayDirectory(pane.workingDirectory),
          sessionLabel: labelOf(session),
        })),
      ),
    );
  }

  // The results each prefix narrows the Command Palette to.
  const paletteScopes: Record<string, () => PaletteResult[]> = {
    "ss ": sessionResults,
    "tt ": tabResults,
    "pp ": paneResults,
  };

  // The results a query's prefix narrows to, in the order they're offered, and the rest of the query to search them by.
  function parsePaletteQuery(query: string) {
    const prefix = Object.keys(paletteScopes).find((candidate) => query.startsWith(candidate));
    if (prefix) return { results: paletteScopes[prefix](), search: query.slice(prefix.length) };
    return { results: [...sessionResults(), ...tabResults(), ...paneResults(), ...actionResults()], search: query };
  }

  function reopenSession(sessionId: SessionId) {
    if (findSession(sessionId)?.status !== "closed") return;
    updateSession(sessionId, (session) => {
      if (session.tabs.length > 0) return { ...restartShells(session), status: "open" };
      const tab = openTab(session.rootDirectory ?? homeDirectory);
      return { ...session, status: "open", tabs: [tab], focusedTabId: tab.id };
    });
    makeCurrent(sessionId);
  }

  // Makes the Session the Current Session, reopening it first when it's closed.
  function jumpToSession(sessionId: SessionId) {
    const session = findSession(sessionId);
    if (session?.status === "closed") reopenSession(sessionId);
    else if (session) makeCurrent(sessionId);
  }

  // Makes the Tab's Session, when open, the Current Session with the Tab focused.
  function jumpToTab(tabId: TabId) {
    const session = state.sessions.find((candidate) => candidate.tabs.some((tab) => tab.id === tabId));
    if (session?.status !== "open") return;
    updateSession(session.id, (session) =>
      session.focusedTabId === tabId ? session : { ...session, focusedTabId: tabId },
    );
    makeCurrent(session.id);
  }

  // Makes the Pane's Session, when open, the Current Session with the Pane and its Tab focused.
  function jumpToPane(paneId: PaneId) {
    const session = findSessionWithPane(paneId);
    if (session?.status !== "open") return;
    const tab = session.tabs.find((candidate) => hasPane(candidate, paneId))!;
    updateSession(session.id, (session) => ({
      ...session,
      tabs: session.tabs.map((candidate) => (candidate === tab ? withFocusedPane(tab, paneId) : candidate)),
    }));
    jumpToTab(tab.id);
  }

  // A result's label and, for a Tab or Pane, what places it: the Pane's working directory and the Session's label.
  function searchedText(result: PaletteResult) {
    if (result.type === "tab") return `${result.label} ${result.sessionLabel}`;
    if (result.type === "pane") return `${result.label} ${result.workingDirectory} ${result.sessionLabel}`;
    return result.label;
  }

  function actionResults(): PaletteResult[] {
    return Object.entries(paletteActionLabels).map(([action, label]) => ({
      type: "action",
      action: action as PaletteAction,
      label,
    }));
  }

  // A stopped Shell can still report on its way out, and a Closed Session keeps its Panes as they were when it closed.
  shellHost.subscribe((event) => {
    if (findSessionWithPane(event.paneId)?.status !== "open") return;
    if (event.type === "shellExited") removePaneFromSession(event.paneId);
    if (event.type === "workingDirectoryChanged") {
      updatePane(event.paneId, (pane) => ({ ...pane, workingDirectory: event.workingDirectory }));
    }
    if (event.type === "runningProgramChanged") {
      updatePane(event.paneId, (pane) => ({ ...pane, runningProgram: event.runningProgram }));
    }
  });

  // The app actions on the Current Session, by the core's own commands.
  const sessionActions: Record<
    Exclude<PaletteAction, "newSession" | "openSettings" | "quit">,
    (sessionId: SessionId) => void
  > = {
    renameSession: (sessionId) => {
      const tab = focusedTabOf(sessionId);
      if (!tab) return;
      const suggestion = uniqueName(folderName(focusedPane(tab).workingDirectory), sessionId);
      emit({ type: "askSessionName", sessionId, suggestion });
    },
    setSessionRoot: (sessionId) => core.setSessionRoot(sessionId),
    clearSessionRoot: (sessionId) => core.clearSessionRoot(sessionId),
    closeSession: (sessionId) => core.closeSession(sessionId),
    deleteSession: (sessionId) => core.deleteRequested(sessionId),
    newTab: (sessionId) => core.newTab(sessionId),
    renameTab: (sessionId) => {
      const tab = focusedTabOf(sessionId);
      if (tab) emit({ type: "askTabTitle", sessionId, tabId: tab.id, suggestion: titleOf(tab) });
    },
    clearTabTitle: (sessionId) => {
      const tab = focusedTabOf(sessionId);
      if (tab) core.clearTabTitle(tab.id);
    },
    splitPaneVertically: (sessionId) => core.splitPane(sessionId, "vertical"),
    splitPaneHorizontally: (sessionId) => core.splitPane(sessionId, "horizontal"),
    closePane: (sessionId) => core.closePane(sessionId),
    nextSession: () => core.focusNextSession(),
    previousSession: () => core.focusPreviousSession(),
    nextTab: (sessionId) => core.focusNextTab(sessionId),
    previousTab: (sessionId) => core.focusPreviousTab(sessionId),
    nextPane: (sessionId) => core.focusNextPane(sessionId),
    previousPane: (sessionId) => core.focusPreviousPane(sessionId),
    focusPaneLeft: (sessionId) => core.focusPaneInDirection(sessionId, "left"),
    focusPaneRight: (sessionId) => core.focusPaneInDirection(sessionId, "right"),
    focusPaneUp: (sessionId) => core.focusPaneInDirection(sessionId, "up"),
    focusPaneDown: (sessionId) => core.focusPaneInDirection(sessionId, "down"),
  };

  // Without a Session, only the actions that don't act on one run.
  function runAction(action: BoundAction, sessionId: SessionId | undefined) {
    if (action === "newSession") return core.newSession();
    if (action === "openSettings") return emit({ type: "openSettings" });
    if (action === "quit") return core.quitRequested();
    if (sessionId === undefined) return;
    if (action === "openCommandPalette") return emit({ type: "openPalette", sessionId });
    if (action.startsWith("focusTab")) return core.focusTab(sessionId, Number(action.slice("focusTab".length)) - 1);
    sessionActions[action as keyof typeof sessionActions](sessionId);
  }

  const core: Core = {
    start: command(() => {
      const saved = stateStore.load();
      if (saved) restore(saved);
      // The app starts shown, so it needs a Session to show.
      if (state.currentSessionId === undefined) addSession();
    }),
    state: () => state,
    hotkeyPressed: command(() => {
      appShown = !appShown;
      if (!appShown) return emit({ type: "hideApp" });
      if (state.currentSessionId === undefined) {
        if (settings.hotkeyWithNoOpenSessions === "palette") return emit({ type: "showPalette" });
        addSession();
      }
      emit({ type: "showApp", sessionId: state.currentSessionId! });
    }),
    paletteDismissed: command(hideWithNoCurrentSession),
    focusLost: command(() => {
      if (!appShown) return;
      appShown = false;
      emit({ type: "hideApp" });
    }),
    quitRequested: command(() => emit({ type: "confirmQuit" })),
    quitCancelled: command(hideWithNoCurrentSession),
    quitConfirmed: command(() => {
      stateStore.flush();
      emit({ type: "quit" });
    }),
    configChanged: command((config) => {
      const parsed = parseConfig(config);
      if (!parsed) return emit({ type: "configUnreadable" });
      settings = parsed.settings;
      if (parsed.rejected.length > 0) emit({ type: "settingsRejected", settings: parsed.rejected });
    }),
    configUnreadable: command(() => emit({ type: "configUnreadable" })),
    settings: () => settings,
    newSession: command(() => {
      addSession();
      emit({ type: "showSession", sessionId: state.currentSessionId! });
    }),
    reopenSession: command(reopenSession),
    renameSession: command((sessionId, name) => {
      const trimmed = name.trim();
      if (trimmed === "") return;
      updateSession(sessionId, ({ labelNumber: _freed, ...session }) => ({
        ...session,
        name: uniqueName(trimmed, sessionId),
      }));
    }),
    setSessionRoot: command((sessionId) => {
      updateSession(sessionId, (session) => {
        const tab = focusedTab(session);
        if (!tab) return session;
        const rootDirectory = focusedPane(tab).workingDirectory;
        return rootDirectory === session.rootDirectory ? session : { ...session, rootDirectory };
      });
    }),
    clearSessionRoot: command((sessionId) => {
      updateSession(sessionId, (session) => {
        if (session.rootDirectory === undefined) return session;
        const { rootDirectory: _cleared, ...cleared } = session;
        return cleared;
      });
    }),
    closeSession: command((sessionId) => {
      const session = findSession(sessionId);
      if (session?.status !== "open") return;
      updateSession(sessionId, (session) => ({ ...session, status: "closed" }));
      for (const paneId of paneIdsOf(session)) shellHost.stop(paneId);
      closeWindow(sessionId);
    }),
    deleteRequested: command((sessionId) => {
      if (findSession(sessionId)) emit({ type: "confirmDelete", sessionId });
    }),
    deleteConfirmed: command((sessionId) => {
      const session = findSession(sessionId);
      if (!session) return;
      const paneIds = paneIdsOf(session);
      scrollback = Object.fromEntries(Object.entries(scrollback).filter(([paneId]) => !paneIds.includes(paneId)));
      // The Current Session goes with it, so no state names a Session that no longer exists.
      const wasCurrent = sessionId === state.currentSessionId;
      setState({
        sessions: state.sessions.filter((candidate) => candidate !== session),
        currentSessionId: wasCurrent ? undefined : state.currentSessionId,
      });
      if (session.status !== "open") return;
      for (const paneId of paneIds) shellHost.stop(paneId);
      emit({ type: "closeWindow", sessionId });
      if (wasCurrent) replaceCurrentSession();
    }),
    focusPreviousSession: () => focusSessionBy(-1),
    focusNextSession: () => focusSessionBy(1),
    newTab: command((sessionId) => {
      const session = findSession(sessionId);
      const current = session && focusedTab(session);
      if (!current) return;
      const tab = openTab(session.rootDirectory ?? focusedPane(current).workingDirectory);
      updateSession(sessionId, (session) => ({ ...session, tabs: [...session.tabs, tab], focusedTabId: tab.id }));
    }),
    splitPane: command((sessionId, direction) => {
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
    }),
    closePane: command((sessionId) => {
      const tab = focusedTabOf(sessionId);
      if (!tab) return;
      removePaneFromSession(tab.focusedPaneId);
      shellHost.stop(tab.focusedPaneId);
    }),
    focusPreviousPane: command((sessionId) => focusPaneBy(sessionId, -1)),
    focusNextPane: command((sessionId) => focusPaneBy(sessionId, 1)),
    focusPaneInDirection: command((sessionId, direction) => {
      updateFocusedTab(sessionId, (tab) => {
        const neighbour = neighbourOf(tab.layout, tab.focusedPaneId, direction);
        return neighbour ? withFocusedPane(tab, neighbour) : tab;
      });
    }),
    // Not a command itself, so that cycling Sessions by shortcut keeps its run of presses going.
    keyPressed(sessionId, keyPress) {
      const bound = Object.entries(settings.keyBindings).find(
        ([, shortcut]) => shortcut && matchesShortcut(keyPress, shortcut),
      );
      if (!bound) return false;
      runAction(bound[0] as BoundAction, sessionId);
      return true;
    },
    focusPane: command((paneId) => {
      const session = findSessionWithPane(paneId);
      if (!session) return;
      updateSession(session.id, (session) => ({
        ...session,
        tabs: session.tabs.map((tab) => (hasPane(tab, paneId) ? withFocusedPane(tab, paneId) : tab)),
      }));
    }),
    focusTab: command((sessionId, position) => {
      updateSession(sessionId, (session) => {
        const tab = session.tabs[position];
        return tab && tab.id !== session.focusedTabId ? { ...session, focusedTabId: tab.id } : session;
      });
    }),
    focusPreviousTab: command((sessionId) => focusTabBy(sessionId, -1)),
    focusNextTab: command((sessionId) => focusTabBy(sessionId, 1)),
    renameTab: command((tabId, title) => {
      const trimmed = title.trim();
      updateTab(tabId, (tab) => {
        if (trimmed === "") return clearTitle(tab);
        return trimmed === tab.title ? tab : { ...tab, title: trimmed };
      });
    }),
    clearTabTitle: command((tabId) => updateTab(tabId, clearTitle)),
    tabTitle(tabId) {
      const tab = findTab(tabId);
      return tab && titleOf(tab);
    },
    sessionLabel(sessionId) {
      const session = findSession(sessionId);
      return session && labelOf(session);
    },
    sessionsInCycleOrder,
    paletteResults(query) {
      const { results, search } = parsePaletteQuery(query);
      return results
        .map((result) => ({ result, score: fuzzyScore(search, searchedText(result)) }))
        .filter((scored) => scored.score !== undefined)
        .toSorted((a, b) => b.score! - a.score!)
        .map(({ result }) => result);
    },
    // The Command Palette on its own leaves nothing on screen after a choice that shows no Session, except while the
    // quit confirmation waits for an answer.
    choosePaletteResult: command((result) => {
      if (result.type === "session") jumpToSession(result.sessionId);
      if (result.type === "tab") jumpToTab(result.tabId);
      if (result.type === "pane") jumpToPane(result.paneId);
      if (result.type === "action") runAction(result.action, state.currentSessionId);
      if (!(result.type === "action" && result.action === "quit")) hideWithNoCurrentSession();
    }),
    paneRects(tabId) {
      const tab = findTab(tabId);
      return tab ? paneRects(tab.layout) : [];
    },
    scrollbackChanged(paneId, reported) {
      if (!findSessionWithPane(paneId)) return;
      const text = capScrollback(reported, settings.scrollbackLines);
      scrollback = { ...scrollback, [paneId]: { text, savedAt: clock.now() } };
      save();
    },
    scrollback: (paneId) => scrollback[paneId],
    onEffect(listener) {
      effectListeners.push(listener);
    },
    onStateChange(listener) {
      stateListeners.push(listener);
    },
  };
  return core;
}
