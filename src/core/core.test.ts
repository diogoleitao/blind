import { describe, expect, it } from "vitest";
import { createCore } from "./core";
import { createControllableClock, createFakeShellHost } from "./fakes";
import { createInMemoryStateStore } from "./in-memory-state-store";
import type { StateStore } from "./ports";
import { idsIn, panesIn, type Session } from "./state";

// Passing the state store of an earlier core relaunches the app from what that core saved.
function startCore(stateStore: StateStore = createInMemoryStateStore()) {
  const shellHost = createFakeShellHost();
  const clock = createControllableClock(1_000);
  const core = createCore({ shellHost, stateStore, clock, homeDirectory: "/Users/me" });
  const effects: unknown[] = [];
  core.onEffect((effect) => effects.push(effect));
  core.start();
  return { core, shellHost, clock, effects, stateStore };
}

// A Pane on the left, and on the right one on top of another, which is focused.
function startWithThreePanes() {
  const started = startCore();
  const sessionId = started.core.state().sessions[0].id;
  started.core.splitPane(sessionId, "vertical");
  started.core.splitPane(sessionId, "horizontal");
  const tab = started.core.state().sessions[0].tabs[0];
  const [left, topRight, bottomRight] = tab.panes.map((pane) => pane.id);
  return { ...started, sessionId, tabId: tab.id, left, topRight, bottomRight };
}

describe("starting", () => {
  it("opens one Session with one Tab holding one Pane in the home directory", () => {
    const { core } = startCore();

    const { sessions } = core.state();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].status).toBe("open");
    expect(core.state().currentSessionId).toBe(sessions[0].id);
    expect(sessions[0].tabs).toHaveLength(1);
    expect(sessions[0].tabs[0].panes).toHaveLength(1);
    expect(sessions[0].tabs[0].panes[0].workingDirectory).toBe("/Users/me");
  });

  it("starts a Shell for the Pane in its working directory", () => {
    const { core, shellHost } = startCore();

    const pane = core.state().sessions[0].tabs[0].panes[0];
    expect(shellHost.started).toEqual([{ paneId: pane.id, workingDirectory: "/Users/me" }]);
  });

  it("stamps the Session with the clock's time as created and last used", () => {
    const { core } = startCore();

    const session = core.state().sessions[0];
    expect(session.createdAt).toBe(1_000);
    expect(session.lastUsedAt).toBe(1_000);
  });
});

describe("a new Session", () => {
  it("opens unnamed at the home directory, becomes the Current Session and is swapped in", () => {
    const { core, shellHost, clock, effects } = startCore();
    shellHost.changeWorkingDirectory(core.state().sessions[0].tabs[0].panes[0].id, "/Users/me/code/api");
    clock.advance(500);

    core.newSession();

    const session = core.state().sessions[1];
    expect(session.status).toBe("open");
    expect(session.name).toBeUndefined();
    expect(session.createdAt).toBe(1_500);
    expect(session.lastUsedAt).toBe(1_500);
    expect(core.state().currentSessionId).toBe(session.id);
    expect(shellHost.started.at(-1)).toEqual({ paneId: session.tabs[0].panes[0].id, workingDirectory: "/Users/me" });
    expect(effects).toEqual([{ type: "showSession", sessionId: session.id }]);
  });
});

describe("an Unnamed Session's label", () => {
  it("numbers Sessions from 1 and shows the focused Pane's working directory, updating live", () => {
    const { core, shellHost } = startCore();
    core.newSession();
    const [first, second] = core.state().sessions;
    expect(core.sessionLabel(first.id)).toBe("Session 1 (~)");
    expect(core.sessionLabel(second.id)).toBe("Session 2 (~)");

    shellHost.changeWorkingDirectory(second.tabs[0].panes[0].id, "/Users/me/code/api");
    expect(core.sessionLabel(second.id)).toBe("Session 2 (~/code/api)");

    shellHost.changeWorkingDirectory(second.tabs[0].panes[0].id, "/opt/homebrew");
    expect(core.sessionLabel(second.id)).toBe("Session 2 (/opt/homebrew)");
  });

  it("follows the focus between Tabs and Panes", () => {
    const { core, shellHost } = startCore();
    const sessionId = core.state().sessions[0].id;
    core.splitPane(sessionId, "vertical");
    const [left, right] = core.state().sessions[0].tabs[0].panes;
    shellHost.changeWorkingDirectory(left.id, "/Users/me/code/api");
    shellHost.changeWorkingDirectory(right.id, "/Users/me/code/web");
    expect(core.sessionLabel(sessionId)).toBe("Session 1 (~/code/web)");

    core.focusPane(left.id);
    expect(core.sessionLabel(sessionId)).toBe("Session 1 (~/code/api)");

    core.newTab(sessionId);
    shellHost.changeWorkingDirectory(core.state().sessions[0].tabs[1].panes[0].id, "/tmp");
    expect(core.sessionLabel(sessionId)).toBe("Session 1 (/tmp)");
  });

  it("takes the smallest number no other Unnamed Session holds, reusing one freed by naming", () => {
    const { core } = startCore();
    core.newSession();
    core.newSession();
    const [first, second, third] = core.state().sessions;

    core.renameSession(first.id, "api");
    core.newSession();

    const fourth = core.state().sessions[3];
    expect(core.sessionLabel(first.id)).toBe("api");
    expect(core.sessionLabel(second.id)).toBe("Session 2 (~)");
    expect(core.sessionLabel(third.id)).toBe("Session 3 (~)");
    expect(core.sessionLabel(fourth.id)).toBe("Session 1 (~)");
  });

  it("keeps its number while the Session is closed", () => {
    const { core, shellHost } = startCore();
    const first = core.state().sessions[0];
    shellHost.exit(first.tabs[0].panes[0].id);

    core.newSession();

    expect(core.sessionLabel(first.id)).toBe("Session 1 (~)");
    expect(core.sessionLabel(core.state().sessions[1].id)).toBe("Session 2 (~)");
  });

  it("doesn't abbreviate a sibling of the home directory that shares its prefix", () => {
    const { core, shellHost } = startCore();
    const session = core.state().sessions[0];

    shellHost.changeWorkingDirectory(session.tabs[0].panes[0].id, "/Users/meow");

    expect(core.sessionLabel(session.id)).toBe("Session 1 (/Users/meow)");
  });
});

describe("cycling the Current Session", () => {
  function labelsInCycleOrder(core: ReturnType<typeof startCore>["core"]) {
    return core.sessionsInCycleOrder().map((session) => core.sessionLabel(session.id));
  }

  function currentLabel(core: ReturnType<typeof startCore>["core"]) {
    return core.sessionLabel(core.state().currentSessionId!);
  }

  // Sessions created as `zed`, Session 2, Session 1, `api`, `web`, in that order; `web` is the Current Session.
  function startWithFiveSessions() {
    const started = startCore();
    const { core } = started;
    core.newSession();
    core.renameSession(core.state().sessions[0].id, "zed");
    for (const name of [undefined, "api", "web"]) {
      core.newSession();
      if (name) core.renameSession(core.state().sessions.at(-1)!.id, name);
    }
    started.effects.length = 0;
    return started;
  }

  it("sorts alphabetically by name, then Unnamed Sessions by label number", () => {
    const { core } = startWithFiveSessions();

    expect(labelsInCycleOrder(core)).toEqual(["api", "web", "zed", "Session 1 (~)", "Session 2 (~)"]);
  });

  it("moves forwards and backwards through that order, wrapping around, swapping each Session in", () => {
    const { core, effects } = startWithFiveSessions();

    core.focusNextSession();
    expect(currentLabel(core)).toBe("zed");

    core.focusNextSession();
    core.focusNextSession();
    core.focusNextSession();
    expect(currentLabel(core)).toBe("api");

    core.focusPreviousSession();
    expect(currentLabel(core)).toBe("Session 2 (~)");
    expect(effects.at(-1)).toEqual({ type: "showSession", sessionId: core.state().currentSessionId });
    expect(effects).toHaveLength(5);
  });

  it("sorts by creation, oldest first, with Unnamed Sessions last, in the created order", () => {
    const { core } = startWithFiveSessions();

    core.settingsChanged({ cycleOrder: "created" });

    expect(labelsInCycleOrder(core)).toEqual(["zed", "api", "web", "Session 2 (~)", "Session 1 (~)"]);
  });

  // Sessions `a`, `b` and `c`, created a second apart in that order, then an Unnamed Session; `c` is the Current
  // Session, and the clock stands a second after the last creation.
  function startWithRecentSessions() {
    const started = startCore();
    const { core, clock } = started;
    core.renameSession(core.state().sessions[0].id, "a");
    for (const name of ["b", "c", undefined]) {
      clock.advance(1_000);
      core.newSession();
      if (name) core.renameSession(core.state().sessions.at(-1)!.id, name);
    }
    core.focusPreviousSession();
    core.newTab(core.state().currentSessionId!);
    clock.advance(1_000);
    core.settingsChanged({ cycleOrder: "recent" });
    return started;
  }

  it("marks the Current Session as the most recently used with the clock's time", () => {
    const { core, clock } = startWithRecentSessions();
    clock.advance(500);

    core.focusNextSession();

    const current = core.state().sessions.find((session) => session.id === core.state().currentSessionId)!;
    expect(current.name).toBe("b");
    expect(current.lastUsedAt).toBe(5_500);
  });

  it("sorts by most recent use, with Unnamed Sessions last, in the recent order", () => {
    const { core } = startWithRecentSessions();

    expect(labelsInCycleOrder(core)).toEqual(["c", "b", "a", "Session 1 (~)"]);
  });

  it("keeps the order from the first press through consecutive presses, re-sorting after any other command", () => {
    const { core, clock } = startWithRecentSessions();

    for (const expected of ["b", "a", "Session 1 (~)", "c"]) {
      clock.advance(1_000);
      core.focusNextSession();
      expect(currentLabel(core)).toBe(expected);
    }

    core.newTab(core.state().currentSessionId!);
    expect(labelsInCycleOrder(core)).toEqual(["c", "a", "b", "Session 1 (~)"]);
    core.focusNextSession();
    expect(currentLabel(core)).toBe("a");
  });

  it("leaves out a Session closed through its last Tab", () => {
    const { core, shellHost } = startWithFiveSessions();
    const zed = core.state().sessions[0];
    shellHost.exit(zed.tabs[0].panes[0].id);

    core.focusNextSession();

    expect(currentLabel(core)).toBe("Session 1 (~)");
  });

  it("requests nothing with a single Open Session", () => {
    const { core, effects } = startCore();

    core.focusNextSession();
    core.focusPreviousSession();

    expect(effects).toEqual([]);
  });
});

describe("a Session's last Tab closing", () => {
  it("swaps in the most recently used Open Session as the Current Session", () => {
    const { core, shellHost, clock, effects } = startCore();
    for (let created = 0; created < 2; created++) {
      clock.advance(1_000);
      core.newSession();
    }
    const [first, second] = core.state().sessions;
    clock.advance(1_000);
    core.focusPreviousSession();
    clock.advance(1_000);
    core.focusPreviousSession();
    effects.length = 0;

    shellHost.exit(first.tabs[0].panes[0].id);

    expect(core.state().currentSessionId).toBe(second.id);
    expect(effects).toEqual([
      { type: "closeWindow", sessionId: first.id },
      { type: "showSession", sessionId: second.id },
    ]);
  });

  it("while the app is hidden, changes the Current Session without showing it", () => {
    const { core, shellHost, effects } = startCore();
    core.newSession();
    const [first, second] = core.state().sessions;
    core.hotkeyPressed();
    effects.length = 0;

    shellHost.exit(second.tabs[0].panes[0].id);

    expect(core.state().currentSessionId).toBe(first.id);
    expect(effects).toEqual([{ type: "closeWindow", sessionId: second.id }]);
  });

  it("of a Session that isn't the Current Session, keeps the Current Session", () => {
    const { core, shellHost, effects } = startCore();
    const first = core.state().sessions[0];
    core.newSession();
    const second = core.state().sessions[1];
    effects.length = 0;

    shellHost.exit(first.tabs[0].panes[0].id);

    expect(core.state().currentSessionId).toBe(second.id);
    expect(effects).toEqual([{ type: "closeWindow", sessionId: first.id }]);
  });

  it("of the last Open Session, leaves no Current Session and hides the app", () => {
    const { core, shellHost, effects } = startCore();
    const session = core.state().sessions[0];

    shellHost.exit(session.tabs[0].panes[0].id);

    expect(core.state().currentSessionId).toBeUndefined();
    expect(effects).toEqual([{ type: "closeWindow", sessionId: session.id }, { type: "hideApp" }]);
  });

  it("of the last Open Session while the app is hidden, requests only its window to close", () => {
    const { core, shellHost, effects } = startCore();
    const session = core.state().sessions[0];
    core.hotkeyPressed();
    effects.length = 0;

    shellHost.exit(session.tabs[0].panes[0].id);

    expect(effects).toEqual([{ type: "closeWindow", sessionId: session.id }]);
  });
});

describe("the Hotkey", () => {
  it("hides the app when pressed after starting, since the app starts shown", () => {
    const { core, effects } = startCore();

    core.hotkeyPressed();

    expect(effects).toEqual([{ type: "hideApp" }]);
  });

  it("toggles between hiding and showing the app on each press", () => {
    const { core, effects } = startCore();
    const sessionId = core.state().sessions[0].id;

    core.hotkeyPressed();
    core.hotkeyPressed();
    core.hotkeyPressed();

    expect(effects).toEqual([{ type: "hideApp" }, { type: "showApp", sessionId }, { type: "hideApp" }]);
  });

  it("shows the most recently used Session", () => {
    const { core, clock, effects } = startCore();
    const first = core.state().sessions[0];
    clock.advance(1_000);
    core.newSession();
    clock.advance(1_000);
    core.focusPreviousSession();
    core.hotkeyPressed();

    core.hotkeyPressed();

    expect(effects.at(-1)).toEqual({ type: "showApp", sessionId: first.id });
  });

  it("with no Open Sessions, opens a new Session at the home directory and shows it", () => {
    const { core, shellHost, effects } = startCore();
    const closed = core.state().sessions[0];
    shellHost.changeWorkingDirectory(closed.tabs[0].panes[0].id, "/Users/me/code/api");
    shellHost.exit(closed.tabs[0].panes[0].id);
    effects.length = 0;

    core.hotkeyPressed();

    const session = core.state().sessions[1];
    expect(session.status).toBe("open");
    expect(core.state().currentSessionId).toBe(session.id);
    expect(shellHost.started.at(-1)).toEqual({ paneId: session.tabs[0].panes[0].id, workingDirectory: "/Users/me" });
    expect(effects).toEqual([{ type: "showApp", sessionId: session.id }]);
  });
});

describe("focus loss", () => {
  it("hides the app while it's shown", () => {
    const { core, effects } = startCore();

    core.focusLost();

    expect(effects).toEqual([{ type: "hideApp" }]);
  });

  it("requests nothing while the app is hidden", () => {
    const { core, effects } = startCore();
    core.hotkeyPressed();
    effects.length = 0;

    core.focusLost();

    expect(effects).toEqual([]);
  });

  it("leaves the app hidden, so the next Hotkey press shows it", () => {
    const { core, effects } = startCore();
    const sessionId = core.state().sessions[0].id;
    core.focusLost();

    core.hotkeyPressed();

    expect(effects).toEqual([{ type: "hideApp" }, { type: "showApp", sessionId }]);
  });
});

describe("a new Tab", () => {
  it("starts its Shell in the current Pane's working directory and becomes the focused Tab", () => {
    const { core, shellHost } = startCore();
    const session = core.state().sessions[0];
    shellHost.changeWorkingDirectory(session.tabs[0].panes[0].id, "/Users/me/code/api");

    core.newTab(session.id);

    const { tabs, focusedTabId } = core.state().sessions[0];
    expect(tabs).toHaveLength(2);
    expect(focusedTabId).toBe(tabs[1].id);
    expect(tabs[1].panes[0].workingDirectory).toBe("/Users/me/code/api");
    expect(shellHost.started.at(-1)).toEqual({ paneId: tabs[1].panes[0].id, workingDirectory: "/Users/me/code/api" });
  });
});

describe("splitting a Pane", () => {
  it("starts a new Pane's Shell in the current Pane's working directory and focuses the new Pane", () => {
    const { core, shellHost } = startCore();
    const session = core.state().sessions[0];
    const firstPaneId = session.tabs[0].panes[0].id;
    shellHost.changeWorkingDirectory(firstPaneId, "/Users/me/code/api");

    core.splitPane(session.id, "vertical");

    const tab = core.state().sessions[0].tabs[0];
    expect(tab.panes.map((pane) => pane.workingDirectory)).toEqual(["/Users/me/code/api", "/Users/me/code/api"]);
    expect(tab.focusedPaneId).toBe(tab.panes[1].id);
    expect(shellHost.started.at(-1)).toEqual({ paneId: tab.panes[1].id, workingDirectory: "/Users/me/code/api" });
  });

  it("halves the Pane side by side when vertical and stacked when horizontal, nesting without limit", () => {
    const { core } = startCore();
    const sessionId = core.state().sessions[0].id;

    core.splitPane(sessionId, "vertical");
    core.splitPane(sessionId, "horizontal");
    core.splitPane(sessionId, "vertical");

    const tab = core.state().sessions[0].tabs[0];
    const [left, topRight, bottomRightLeft, bottomRightRight] = tab.panes.map((pane) => pane.id);
    expect(core.paneRects(tab.id)).toEqual([
      { paneId: left, x: 0, y: 0, width: 0.5, height: 1 },
      { paneId: topRight, x: 0.5, y: 0, width: 0.5, height: 0.5 },
      { paneId: bottomRightLeft, x: 0.5, y: 0.5, width: 0.25, height: 0.5 },
      { paneId: bottomRightRight, x: 0.75, y: 0.5, width: 0.25, height: 0.5 },
    ]);
  });
});

describe("moving focus between Panes", () => {
  function focusedPaneId(core: ReturnType<typeof startCore>["core"]) {
    return core.state().sessions[0].tabs[0].focusedPaneId;
  }

  it("goes to the previous and next Pane in layout order, wrapping around", () => {
    const { core, sessionId, left, topRight, bottomRight } = startWithThreePanes();

    core.focusPreviousPane(sessionId);
    expect(focusedPaneId(core)).toBe(topRight);

    core.focusPreviousPane(sessionId);
    core.focusPreviousPane(sessionId);
    expect(focusedPaneId(core)).toBe(bottomRight);

    core.focusNextPane(sessionId);
    expect(focusedPaneId(core)).toBe(left);
  });

  it("goes to the neighbouring Pane in a direction", () => {
    const { core, sessionId, left, topRight, bottomRight } = startWithThreePanes();

    core.focusPaneInDirection(sessionId, "up");
    expect(focusedPaneId(core)).toBe(topRight);

    core.focusPaneInDirection(sessionId, "down");
    expect(focusedPaneId(core)).toBe(bottomRight);

    core.focusPaneInDirection(sessionId, "left");
    expect(focusedPaneId(core)).toBe(left);
  });

  it("goes to the earliest Pane in layout order when several touch the same length of edge", () => {
    const { core, sessionId, left, topRight } = startWithThreePanes();
    core.focusPane(left);

    core.focusPaneInDirection(sessionId, "right");

    expect(focusedPaneId(core)).toBe(topRight);
  });

  it("stays put when there's no Pane in that direction", () => {
    const { core, sessionId, topRight } = startWithThreePanes();
    core.focusPane(topRight);

    core.focusPaneInDirection(sessionId, "up");
    core.focusPaneInDirection(sessionId, "right");

    expect(focusedPaneId(core)).toBe(topRight);
  });

  it("focuses a Pane by its id, as a click on it does", () => {
    const { core, left } = startWithThreePanes();

    core.focusPane(left);

    expect(focusedPaneId(core)).toBe(left);
  });
});

describe("closing a Pane", () => {
  it("stops its Shell and lets its sibling fill the space, focusing the sibling", () => {
    const { core, shellHost, sessionId, tabId, left, topRight, bottomRight } = startWithThreePanes();

    core.closePane(sessionId);

    expect(shellHost.stopped).toEqual([bottomRight]);
    expect(core.paneRects(tabId)).toEqual([
      { paneId: left, x: 0, y: 0, width: 0.5, height: 1 },
      { paneId: topRight, x: 0.5, y: 0, width: 0.5, height: 1 },
    ]);
    expect(core.state().sessions[0].tabs[0].focusedPaneId).toBe(topRight);
  });

  it("happens when its Shell exits, keeping the focus where it was", () => {
    const { core, shellHost, tabId, left, topRight, bottomRight } = startWithThreePanes();

    shellHost.exit(left);

    expect(core.paneRects(tabId)).toEqual([
      { paneId: topRight, x: 0, y: 0, width: 1, height: 0.5 },
      { paneId: bottomRight, x: 0, y: 0.5, width: 1, height: 0.5 },
    ]);
    expect(core.state().sessions[0].tabs[0].focusedPaneId).toBe(bottomRight);
  });

  it("focuses the Pane nearest to it in the split that fills its space", () => {
    const { core, sessionId, left, topRight } = startWithThreePanes();
    core.focusPane(left);

    core.closePane(sessionId);

    expect(core.state().sessions[0].tabs[0].focusedPaneId).toBe(topRight);
  });

  it("as the last Pane of a Tab, closes the Tab and leaves the Session open", () => {
    const { core, effects } = startCore();
    const sessionId = core.state().sessions[0].id;
    core.newTab(sessionId);
    const [first] = core.state().sessions[0].tabs;

    core.closePane(sessionId);

    const session = core.state().sessions[0];
    expect(session.status).toBe("open");
    expect(session.tabs.map((tab) => tab.id)).toEqual([first.id]);
    expect(session.focusedTabId).toBe(first.id);
    expect(effects).toEqual([]);
  });

  it("as the last Pane of the last Tab, closes the Session and requests its window to close", () => {
    const { core, effects } = startCore();
    const sessionId = core.state().sessions[0].id;

    core.closePane(sessionId);

    expect(core.state().sessions[0].status).toBe("closed");
    expect(effects[0]).toEqual({ type: "closeWindow", sessionId });
  });

  it("ignores the stopped Shell's exit that follows", () => {
    const { core, shellHost, sessionId, bottomRight } = startWithThreePanes();
    core.closePane(sessionId);
    const announced: unknown[] = [];
    core.onStateChange((state) => announced.push(state));

    shellHost.exit(bottomRight);

    expect(announced).toEqual([]);
  });
});

describe("switching Tabs", () => {
  function startWithThreeTabs() {
    const started = startCore();
    const sessionId = started.core.state().sessions[0].id;
    started.core.newTab(sessionId);
    started.core.newTab(sessionId);
    const tabIds = started.core.state().sessions[0].tabs.map((tab) => tab.id);
    return { ...started, sessionId, tabIds };
  }

  it("focuses the Tab at a position", () => {
    const { core, sessionId, tabIds } = startWithThreeTabs();

    core.focusTab(sessionId, 0);

    expect(core.state().sessions[0].focusedTabId).toBe(tabIds[0]);
  });

  it("keeps the focused Tab when there's no Tab at that position", () => {
    const { core, sessionId, tabIds } = startWithThreeTabs();

    core.focusTab(sessionId, 3);

    expect(core.state().sessions[0].focusedTabId).toBe(tabIds[2]);
  });

  it("moves to the previous and next Tab", () => {
    const { core, sessionId, tabIds } = startWithThreeTabs();
    core.focusTab(sessionId, 1);

    core.focusPreviousTab(sessionId);
    expect(core.state().sessions[0].focusedTabId).toBe(tabIds[0]);

    core.focusNextTab(sessionId);
    core.focusNextTab(sessionId);
    expect(core.state().sessions[0].focusedTabId).toBe(tabIds[2]);
  });

  it("wraps around from the last Tab to the first and back", () => {
    const { core, sessionId, tabIds } = startWithThreeTabs();

    core.focusNextTab(sessionId);
    expect(core.state().sessions[0].focusedTabId).toBe(tabIds[0]);

    core.focusPreviousTab(sessionId);
    expect(core.state().sessions[0].focusedTabId).toBe(tabIds[2]);
  });

  it("starts a new Tab in the focused Tab's Pane's working directory", () => {
    const { core, shellHost, sessionId } = startWithThreeTabs();
    const firstPaneId = core.state().sessions[0].tabs[0].panes[0].id;
    shellHost.changeWorkingDirectory(firstPaneId, "/Users/me/code/web");

    core.focusTab(sessionId, 0);
    core.newTab(sessionId);

    expect(shellHost.started.at(-1)?.workingDirectory).toBe("/Users/me/code/web");
  });
});

describe("a Tab's title", () => {
  it("is the working directory's folder name while the Shell is idle, following directory changes", () => {
    const { core, shellHost } = startCore();
    const tab = core.state().sessions[0].tabs[0];
    expect(core.tabTitle(tab.id)).toBe("me");

    shellHost.changeWorkingDirectory(tab.panes[0].id, "/Users/me/code/api");

    expect(core.tabTitle(tab.id)).toBe("api");
  });

  it("is the running program while one runs, and the folder name again once it ends", () => {
    const { core, shellHost } = startCore();
    const tab = core.state().sessions[0].tabs[0];

    shellHost.changeRunningProgram(tab.panes[0].id, "vim");
    expect(core.tabTitle(tab.id)).toBe("vim");

    shellHost.changeRunningProgram(tab.panes[0].id, undefined);
    expect(core.tabTitle(tab.id)).toBe("me");
  });
});

describe("state changes", () => {
  it("are announced for Tab commands and Shell events, with the new state", () => {
    const { core, shellHost } = startCore();
    const sessionId = core.state().sessions[0].id;
    const paneId = core.state().sessions[0].tabs[0].panes[0].id;
    const announced: unknown[] = [];
    core.onStateChange((state) => announced.push(state));

    core.newTab(sessionId);
    core.focusPreviousTab(sessionId);
    shellHost.changeWorkingDirectory(paneId, "/Users/me/code");
    shellHost.changeRunningProgram(paneId, "vim");

    expect(announced).toHaveLength(4);
    expect(announced.at(-1)).toBe(core.state());
  });

  it("aren't announced for the Hotkey, which doesn't touch Sessions", () => {
    const { core } = startCore();
    const announced: unknown[] = [];
    core.onStateChange((state) => announced.push(state));

    core.hotkeyPressed();

    expect(announced).toEqual([]);
  });
});

describe("a Shell exiting", () => {
  it("closes its Pane, and as the last Pane, closes the Session and requests its window to close", () => {
    const { core, shellHost, effects } = startCore();
    const session = core.state().sessions[0];

    shellHost.exit(session.tabs[0].panes[0].id);

    expect(core.state().sessions[0].status).toBe("closed");
    expect(core.state().sessions[0].tabs).toEqual([]);
    expect(effects[0]).toEqual({ type: "closeWindow", sessionId: session.id });
  });

  it("closing the focused Tab focuses the Tab that takes its place, or the new last Tab", () => {
    const { core, shellHost } = startCore();
    const sessionId = core.state().sessions[0].id;
    core.newTab(sessionId);
    core.newTab(sessionId);
    const [first, second, third] = core.state().sessions[0].tabs;
    core.focusTab(sessionId, 1);

    shellHost.exit(second.panes[0].id);
    expect(core.state().sessions[0].focusedTabId).toBe(third.id);

    shellHost.exit(third.panes[0].id);
    expect(core.state().sessions[0].focusedTabId).toBe(first.id);
  });

  it("closing another Tab keeps the focused Tab", () => {
    const { core, shellHost } = startCore();
    const sessionId = core.state().sessions[0].id;
    core.newTab(sessionId);
    const [first, second] = core.state().sessions[0].tabs;

    shellHost.exit(first.panes[0].id);

    expect(core.state().sessions[0].focusedTabId).toBe(second.id);
  });
});

describe("Restore", () => {
  // An `api` Session with two Tabs, the first split in two, and an Unnamed Session, each Pane somewhere of its own.
  function startWithWork() {
    const started = startCore();
    const { core, shellHost } = started;
    const api = core.state().sessions[0].id;
    core.renameSession(api, "api");
    core.splitPane(api, "vertical");
    core.newTab(api);
    core.newSession();
    const directories = ["/Users/me/code/api", "/Users/me/code/api/src", "/tmp", "/Users/me/code/web"];
    panesIn(core.state()).forEach((pane, index) => shellHost.changeWorkingDirectory(pane.id, directories[index]));
    return started;
  }

  it("brings back every Session with its Tabs, Pane layout and working directories, starting a fresh Shell per Pane", () => {
    const before = startWithWork();

    const after = startCore(before.stateStore);

    expect(after.core.state()).toEqual(before.core.state());
    expect(after.shellHost.started).toEqual([
      { paneId: expect.any(String), workingDirectory: "/Users/me/code/api" },
      { paneId: expect.any(String), workingDirectory: "/Users/me/code/api/src" },
      { paneId: expect.any(String), workingDirectory: "/tmp" },
      { paneId: expect.any(String), workingDirectory: "/Users/me/code/web" },
    ]);
  });

  it("doesn't bring back the running program, since the Shells start fresh", () => {
    const before = startCore();
    const tab = before.core.state().sessions[0].tabs[0];
    before.shellHost.changeRunningProgram(tab.panes[0].id, "vim");

    const after = startCore(before.stateStore);

    expect(after.core.state().sessions[0].tabs[0].panes[0].runningProgram).toBeUndefined();
    expect(after.core.tabTitle(tab.id)).toBe("me");
  });

  it("makes the most recently used Open Session the Current Session", () => {
    const before = startCore();
    before.clock.advance(1_000);
    before.core.newSession();
    before.clock.advance(1_000);
    before.core.focusNextSession();

    const after = startCore(before.stateStore);

    expect(after.core.state().currentSessionId).toBe(before.core.state().sessions[0].id);
  });

  it("keeps Closed Sessions closed, without starting Shells for them", () => {
    const before = startCore();
    const closed = before.core.state().sessions[0];
    before.core.newSession();
    before.shellHost.exit(closed.tabs[0].panes[0].id);

    const after = startCore(before.stateStore);

    expect(after.core.state().sessions[0]).toEqual({ ...closed, status: "closed", tabs: [], focusedTabId: undefined });
    expect(after.shellHost.started).toHaveLength(1);
  });

  it("with no Open Sessions saved, opens a new Session at the home directory as the Current Session", () => {
    const before = startCore();
    const closed = before.core.state().sessions[0];
    before.shellHost.changeWorkingDirectory(closed.tabs[0].panes[0].id, "/Users/me/code/api");
    before.shellHost.exit(closed.tabs[0].panes[0].id);

    const after = startCore(before.stateStore);

    const [, session] = after.core.state().sessions;
    expect(session.status).toBe("open");
    expect(after.core.state().currentSessionId).toBe(session.id);
    expect(after.core.sessionLabel(session.id)).toBe("Session 2 (~)");
    expect(after.shellHost.started).toEqual([{ paneId: session.tabs[0].panes[0].id, workingDirectory: "/Users/me" }]);
  });

  it("gives Sessions, Tabs and Panes opened afterwards ids no restored one holds", () => {
    const before = startWithWork();
    const after = startCore(before.stateStore);
    const sessionId = after.core.state().currentSessionId!;

    after.core.newSession();
    after.core.newTab(sessionId);
    after.core.splitPane(sessionId, "vertical");

    const ids = idsIn(after.core.state());
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("brings back each Pane's scrollback as its terminal last reported it, with the clock's time of that report", () => {
    const before = startWithThreePanes();
    before.core.scrollbackChanged(before.left, "$ ls\r\nsrc");
    before.clock.advance(60_000);
    before.core.scrollbackChanged(before.left, "$ ls\r\nsrc\r\n$ pwd\r\n/Users/me");

    const after = startCore(before.stateStore);

    expect(after.core.scrollback(before.left)).toEqual({ text: "$ ls\r\nsrc\r\n$ pwd\r\n/Users/me", savedAt: 61_000 });
    expect(after.core.scrollback(before.topRight)).toBeUndefined();
  });

  it("caps a Pane's scrollback at its last 10,000 lines", () => {
    const { core } = startCore();
    const paneId = core.state().sessions[0].tabs[0].panes[0].id;
    const lines = Array.from({ length: 10_005 }, (_, index) => `line ${index + 1}`);

    core.scrollbackChanged(paneId, lines.join("\r\n"));

    const kept = core.scrollback(paneId)!.text.split("\r\n");
    expect(kept).toHaveLength(10_000);
    expect(kept[0]).toBe("line 6");
    expect(kept.at(-1)).toBe("line 10005");
  });

  it("drops a closed Pane's scrollback, even when its terminal reports it after the close", () => {
    const before = startWithThreePanes();
    before.core.scrollbackChanged(before.bottomRight, "$ ls");

    before.core.closePane(before.sessionId);
    before.core.scrollbackChanged(before.bottomRight, "$ ls\r\nsrc");
    const after = startCore(before.stateStore);

    expect(after.core.scrollback(before.bottomRight)).toBeUndefined();
  });
});

describe("quitting", () => {
  it("asks for confirmation, without quitting yet", () => {
    const { core, effects } = startCore();

    core.quitRequested();

    expect(effects).toEqual([{ type: "confirmQuit" }]);
  });

  it("once confirmed, writes everything pending to the state store before quitting", () => {
    const calls: string[] = [];
    const inMemory = createInMemoryStateStore();
    const stateStore: StateStore = {
      load: inMemory.load,
      save: (snapshot) => inMemory.save(snapshot),
      flush: () => calls.push("flush"),
    };
    const { core } = startCore(stateStore);
    core.onEffect((effect) => calls.push(effect.type));

    core.quitConfirmed();

    expect(calls).toEqual(["flush", "quit"]);
  });
});

describe("reopening a Closed Session", () => {
  // Relaunches from the saved snapshot with each Session changed by `update`, standing in for what later commands do,
  // such as closing a Session with its Tabs or setting its Root directory.
  function relaunchWith(stateStore: StateStore, update: (session: Session) => Session) {
    const { state, scrollback } = stateStore.load()!;
    stateStore.save({ state: { ...state, sessions: state.sessions.map(update) }, scrollback });
    return startCore(stateStore);
  }

  // A closed `api` Session with two Tabs, the first split in two, and an Open Unnamed Session that is current.
  function startWithClosedApi() {
    const before = startCore();
    const { core, shellHost } = before;
    const api = core.state().sessions[0].id;
    core.renameSession(api, "api");
    core.splitPane(api, "vertical");
    core.newTab(api);
    core.newSession();
    const panes = core.state().sessions[0].tabs.flatMap((tab) => tab.panes);
    ["/Users/me/code/api", "/Users/me/code/api/src", "/tmp"].forEach((directory, index) =>
      shellHost.changeWorkingDirectory(panes[index].id, directory),
    );
    core.scrollbackChanged(panes[0].id, "$ ls\r\nsrc");
    const after = relaunchWith(before.stateStore, (session) =>
      session.id === api ? { ...session, status: "closed" } : session,
    );
    after.effects.length = 0;
    return { ...after, api, saved: before.core.state().sessions[0], firstPaneId: panes[0].id };
  }

  it("brings back its Tabs, Pane layout and working directories with fresh Shells, as the Current Session", () => {
    const { core, shellHost, clock, effects, api, saved } = startWithClosedApi();
    expect(shellHost.started).toHaveLength(1);
    clock.advance(1_000);

    core.reopenSession(api);

    expect(core.state().sessions[0]).toEqual({ ...saved, lastUsedAt: 2_000 });
    expect(core.state().currentSessionId).toBe(api);
    expect(shellHost.started.slice(1)).toEqual([
      { paneId: expect.any(String), workingDirectory: "/Users/me/code/api" },
      { paneId: expect.any(String), workingDirectory: "/Users/me/code/api/src" },
      { paneId: expect.any(String), workingDirectory: "/tmp" },
    ]);
    expect(effects).toEqual([{ type: "showSession", sessionId: api }]);
  });

  it("brings back its scrollback", () => {
    const { core, api, firstPaneId } = startWithClosedApi();

    core.reopenSession(api);

    expect(core.scrollback(firstPaneId)).toEqual({ text: "$ ls\r\nsrc", savedAt: 1_000 });
  });

  it("closed through its last Tab, gives it one fresh Tab at the home directory", () => {
    const { core, shellHost } = startCore();
    const closed = core.state().sessions[0];
    shellHost.changeWorkingDirectory(closed.tabs[0].panes[0].id, "/Users/me/code/api");
    core.newSession();
    shellHost.exit(closed.tabs[0].panes[0].id);

    core.reopenSession(closed.id);

    const session = core.state().sessions[0];
    expect(session.status).toBe("open");
    expect(session.tabs).toHaveLength(1);
    expect(session.focusedTabId).toBe(session.tabs[0].id);
    expect(session.tabs[0].panes[0].workingDirectory).toBe("/Users/me");
    expect(shellHost.started.at(-1)).toEqual({ paneId: session.tabs[0].panes[0].id, workingDirectory: "/Users/me" });
    expect(core.state().currentSessionId).toBe(closed.id);
  });

  it("closed through its last Tab, starts that Tab at its Root directory when it has one", () => {
    const before = startCore();
    const closed = before.core.state().sessions[0];
    before.core.newSession();
    before.shellHost.exit(closed.tabs[0].panes[0].id);
    const after = relaunchWith(before.stateStore, (session) =>
      session.id === closed.id ? { ...session, rootDirectory: "/Users/me/code/api" } : session,
    );

    after.core.reopenSession(closed.id);

    const session = after.core.state().sessions[0];
    expect(session.tabs[0].panes[0].workingDirectory).toBe("/Users/me/code/api");
    expect(after.shellHost.started.at(-1)?.workingDirectory).toBe("/Users/me/code/api");
  });

  it("leaves an Open Session alone", () => {
    const { core, shellHost, effects } = startCore();
    const sessionId = core.state().sessions[0].id;
    const announced: unknown[] = [];
    core.onStateChange((state) => announced.push(state));

    core.reopenSession(sessionId);

    expect(shellHost.started).toHaveLength(1);
    expect(announced).toEqual([]);
    expect(effects).toEqual([]);
  });
});
