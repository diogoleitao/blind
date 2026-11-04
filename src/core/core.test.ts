import { describe, expect, it } from "vitest";
import { createCore } from "./core";
import { createControllableClock, createFakeShellHost } from "./fakes";
import { createInMemoryStateStore } from "./in-memory-state-store";

function startCore() {
  const shellHost = createFakeShellHost();
  const clock = createControllableClock(1_000);
  const core = createCore({
    shellHost,
    stateStore: createInMemoryStateStore(),
    clock,
    homeDirectory: "/Users/me",
  });
  const effects: unknown[] = [];
  core.onEffect((effect) => effects.push(effect));
  core.start();
  return { core, shellHost, clock, effects };
}

describe("starting", () => {
  it("opens one Session with one Tab holding one Pane in the home directory", () => {
    const { core } = startCore();

    const { sessions } = core.state();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].status).toBe("open");
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

describe("the Hotkey", () => {
  it("hides the app when pressed after starting, since the app starts shown", () => {
    const { core, effects } = startCore();

    core.hotkeyPressed();

    expect(effects).toEqual([{ type: "hideApp" }]);
  });

  it("toggles between hiding and showing the app on each press", () => {
    const { core, effects } = startCore();

    core.hotkeyPressed();
    core.hotkeyPressed();
    core.hotkeyPressed();

    expect(effects).toEqual([{ type: "hideApp" }, { type: "showApp" }, { type: "hideApp" }]);
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
    core.focusLost();

    core.hotkeyPressed();

    expect(effects).toEqual([{ type: "hideApp" }, { type: "showApp" }]);
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
    expect(effects).toEqual([{ type: "closeWindow", sessionId: session.id }]);
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
