import { describe, expect, it } from "vitest";
import { createCore, type Effect, type PaletteResult } from "./core";
import type { KeyPress } from "./key-bindings";
import { createControllableClock, createFakeShellHost } from "./fakes";
import { createInMemoryStateStore } from "./in-memory-state-store";
import type { StateStore } from "./ports";
import { idsIn, panesIn, type Session } from "./state";
import { defaultTheme } from "./themes";

// Passing the state store of an earlier core relaunches the app from what that core saved. A config file's text is read
// before starting, as the app does.
function startCore(stateStore: StateStore = createInMemoryStateStore(), config?: string) {
  const shellHost = createFakeShellHost();
  const clock = createControllableClock(1_000);
  const core = createCore({ shellHost, stateStore, clock, homeDirectory: "/Users/me" });
  const effects: unknown[] = [];
  core.onEffect((effect) => effects.push(effect));
  if (config !== undefined) core.configChanged(config);
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

    core.configChanged('{ "cycleOrder": "created" }');

    expect(labelsInCycleOrder(core)).toEqual(["zed", "api", "web", "Session 2 (~)", "Session 1 (~)"]);
  });

  it("goes back to alphabetical once the config file is gone", () => {
    const { core } = startWithFiveSessions();
    core.configChanged('{ "cycleOrder": "created" }');

    core.configChanged(undefined);

    expect(labelsInCycleOrder(core)).toEqual(["api", "web", "zed", "Session 1 (~)", "Session 2 (~)"]);
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
    core.configChanged('{ "cycleOrder": "recent" }');
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

  describe("set to open the Command Palette with no Open Sessions", () => {
    // `api`, closed through its last Tab, so the app is hidden with no Open Sessions.
    function startWithNoOpenSessions() {
      const started = startCore(undefined, '{ "hotkeyWithNoOpenSessions": "palette" }');
      const api = started.core.state().sessions[0];
      started.core.renameSession(api.id, "api");
      started.shellHost.exit(api.tabs[0].panes[0].id);
      started.effects.length = 0;
      return { ...started, api: api.id };
    }

    it("shows the Command Palette on its own, opening no Session", () => {
      const { core, effects } = startWithNoOpenSessions();

      core.hotkeyPressed();

      expect(core.state().sessions).toHaveLength(1);
      expect(core.state().currentSessionId).toBeUndefined();
      expect(effects).toEqual([{ type: "showPalette" }]);
    });

    it("shows a Closed Session chosen from it as the Current Session", () => {
      const { core, effects, api } = startWithNoOpenSessions();
      core.hotkeyPressed();

      core.choosePaletteResult(core.paletteResults("ss api")[0]);

      expect(core.state().currentSessionId).toBe(api);
      expect(effects.at(-1)).toEqual({ type: "showSession", sessionId: api });
    });

    it("hides the app when dismissed, showing the Command Palette again on the next press", () => {
      const { core, effects } = startWithNoOpenSessions();
      core.hotkeyPressed();

      core.paletteDismissed();
      core.hotkeyPressed();

      expect(effects).toEqual([{ type: "showPalette" }, { type: "hideApp" }, { type: "showPalette" }]);
    });

    it("hides the app after a choice that shows no Session", () => {
      const { core, effects } = startWithNoOpenSessions();
      core.hotkeyPressed();

      chooseAction(core, "New Tab");
      core.hotkeyPressed();
      chooseAction(core, "Open Settings");

      expect(effects).toEqual([
        { type: "showPalette" },
        { type: "hideApp" },
        { type: "showPalette" },
        { type: "openSettings" },
        { type: "hideApp" },
      ]);
    });

    it("stays shown while asking to quit, hiding the app once the quit is cancelled", () => {
      const { core, effects } = startWithNoOpenSessions();
      core.hotkeyPressed();

      chooseAction(core, "Quit Blind");
      expect(effects).toEqual([{ type: "showPalette" }, { type: "confirmQuit" }]);

      core.quitCancelled();
      expect(effects.at(-1)).toEqual({ type: "hideApp" });
    });

    it("opens a new Session chosen from it", () => {
      const { core, effects } = startWithNoOpenSessions();
      core.hotkeyPressed();

      chooseAction(core, "New Session");

      expect(effects).toEqual([{ type: "showPalette" }, { type: "showSession", sessionId: core.state().currentSessionId }]);
    });

    it("shows the Command Palette even with no Sessions at all", () => {
      const { core, effects, api } = startWithNoOpenSessions();
      core.deleteConfirmed(api);
      effects.length = 0;

      core.hotkeyPressed();

      expect(core.state().sessions).toEqual([]);
      expect(effects).toEqual([{ type: "showPalette" }]);
    });
  });

  it("rejects anything but `new` or `palette` for what it does with no Open Sessions, opening a new Session", () => {
    const { core, shellHost, effects } = startCore(undefined, '{ "hotkeyWithNoOpenSessions": "nothing" }');
    shellHost.exit(core.state().sessions[0].tabs[0].panes[0].id);

    core.hotkeyPressed();

    expect(core.state().sessions[1].status).toBe("open");
    expect(effects[0]).toEqual({ type: "settingsRejected", settings: ["hotkeyWithNoOpenSessions"] });
  });
});

// A key pressed as the keyboard reports it: the key it produces, the physical key, and the modifiers held, e.g.
// `press("}", "BracketRight", "meta", "shift")`.
function press(key: string, code: string, ...modifiers: ("meta" | "shift" | "alt" | "control")[]): KeyPress {
  return {
    key,
    code,
    meta: modifiers.includes("meta"),
    shift: modifiers.includes("shift"),
    alt: modifiers.includes("alt"),
    control: modifiers.includes("control"),
  };
}

describe("key bindings", () => {
  it("open the Command Palette over the Session's window with Cmd+K by default", () => {
    const { core, effects } = startCore();
    const sessionId = core.state().sessions[0].id;

    expect(core.keyPressed(sessionId, press("k", "KeyK", "meta"))).toBe(true);

    expect(effects).toEqual([{ type: "openPalette", sessionId }]);
  });

  it("run iTerm2's default shortcuts on the Session", () => {
    const { core, effects } = startCore();
    const sessionId = core.state().sessions[0].id;
    const session = () => core.state().sessions[0];
    const tab = () => session().tabs.find((candidate) => candidate.id === session().focusedTabId)!;

    core.keyPressed(sessionId, press("t", "KeyT", "meta"));
    expect(session().tabs).toHaveLength(2);
    core.keyPressed(sessionId, press("1", "Digit1", "meta"));
    expect(session().focusedTabId).toBe(session().tabs[0].id);
    core.keyPressed(sessionId, press("}", "BracketRight", "meta", "shift"));
    expect(session().focusedTabId).toBe(session().tabs[1].id);
    core.keyPressed(sessionId, press("{", "BracketLeft", "meta", "shift"));
    expect(session().focusedTabId).toBe(session().tabs[0].id);
    core.keyPressed(sessionId, press("d", "KeyD", "meta"));
    expect(tab().layout).toMatchObject({ type: "split", direction: "vertical" });
    core.keyPressed(sessionId, press("D", "KeyD", "meta", "shift"));
    expect(tab().layout).toMatchObject({ second: { type: "split", direction: "horizontal" } });
    core.keyPressed(sessionId, press("[", "BracketLeft", "meta"));
    expect(tab().focusedPaneId).toBe(tab().panes[1].id);
    core.keyPressed(sessionId, press("]", "BracketRight", "meta"));
    expect(tab().focusedPaneId).toBe(tab().panes[2].id);
    core.keyPressed(sessionId, press("ArrowLeft", "ArrowLeft", "meta", "alt"));
    expect(tab().focusedPaneId).toBe(tab().panes[0].id);
    core.keyPressed(sessionId, press("w", "KeyW", "meta"));
    expect(tab().panes).toHaveLength(2);
    core.keyPressed(sessionId, press("n", "KeyN", "meta"));
    expect(core.state().sessions).toHaveLength(2);
    core.keyPressed(sessionId, press("`", "Backquote", "meta"));
    expect(core.state().currentSessionId).toBe(sessionId);
    core.keyPressed(sessionId, press("~", "Backquote", "meta", "shift"));
    expect(core.state().currentSessionId).not.toBe(sessionId);
    expect(effects).toHaveLength(3);
  });

  it("leave every other key to the Pane's terminal", () => {
    const { core, effects } = startCore();
    const sessionId = core.state().sessions[0].id;

    for (const keyPress of [
      press("k", "KeyK"),
      press("J", "KeyJ", "meta", "shift"),
      press("k", "KeyK", "meta", "control"),
      press("j", "KeyJ", "meta"),
      press("0", "Digit0", "meta"),
    ]) {
      expect(core.keyPressed(sessionId, keyPress)).toBe(false);
    }
    expect(effects).toEqual([]);
  });

  it("follow the config file, which can rebind or unbind any action and bind app actions with no default", () => {
    const { core, effects } = startCore();
    const sessionId = core.state().sessions[0].id;

    core.configChanged(`{
      "keyBindings": {
        "openCommandPalette": "Cmd+P",
        "closePane": null,
        "openSettings": "cmd + option + ,",
        "focusPaneLeft": "Ctrl+Shift+Left",
      },
    }`);

    expect(core.keyPressed(sessionId, press("k", "KeyK", "meta"))).toBe(false);
    expect(core.keyPressed(sessionId, press("w", "KeyW", "meta"))).toBe(false);
    expect(core.keyPressed(sessionId, press("p", "KeyP", "meta"))).toBe(true);
    expect(core.keyPressed(sessionId, press("≤", "Comma", "meta", "alt"))).toBe(true);
    expect(core.keyPressed(sessionId, press("ArrowLeft", "ArrowLeft", "control", "shift"))).toBe(true);
    expect(core.keyPressed(sessionId, press("t", "KeyT", "meta"))).toBe(true);
    expect(effects).toEqual([{ type: "openPalette", sessionId }, { type: "openSettings" }]);
  });

  it("match a letter by its key's position while Option turns it into another character", () => {
    const { core, effects } = startCore(undefined, '{ "keyBindings": { "openSettings": "Cmd+Alt+D" } }');
    const sessionId = core.state().sessions[0].id;

    expect(core.keyPressed(sessionId, press("∂", "KeyD", "meta", "alt"))).toBe(true);
    expect(core.keyPressed(sessionId, press("∂", "KeyD", "meta"))).toBe(false);
    expect(effects).toEqual([{ type: "openSettings" }]);
  });

  it("take a configured shortcut away from the action it's bound to by default", () => {
    const { core } = startCore(undefined, '{ "keyBindings": { "closeSession": "Cmd+W" } }');
    const sessionId = core.state().sessions[0].id;
    core.splitPane(sessionId, "vertical");

    core.keyPressed(sessionId, press("w", "KeyW", "meta"));

    expect(core.state().sessions[0].status).toBe("closed");
    expect(core.state().sessions[0].tabs[0].panes).toHaveLength(2);
  });

  it("reject unknown actions, shortcuts without a modifier or that can't be read, and repeated shortcuts", () => {
    const { core, effects } = startCore(
      undefined,
      `{
        "keyBindings": {
          "closeSession": "Cmd+W",
          "launchRockets": "Cmd+R",
          "newTab": "T",
          "nextTab": "Cmd+Hyper+]",
          "previousTab": 42,
          "renameTab": "Cmd+W",
        },
      }`,
    );
    const sessionId = core.state().sessions[0].id;

    core.keyPressed(sessionId, press("{", "BracketLeft", "meta", "shift"));
    core.keyPressed(sessionId, press("t", "KeyT", "meta"));

    expect(effects).toEqual([
      {
        type: "settingsRejected",
        settings: [
          "keyBindings.launchRockets",
          "keyBindings.newTab",
          "keyBindings.nextTab",
          "keyBindings.previousTab",
          "keyBindings.renameTab",
        ],
      },
    ]);
    expect(core.state().sessions[0].tabs).toHaveLength(2);
    expect(core.state().sessions[0].focusedTabId).toBe(core.state().sessions[0].tabs[1].id);
  });

  it("reject shortcuts without Cmd or Ctrl, which would take typed characters from the Pane's terminal", () => {
    const { core, effects } = startCore(
      undefined,
      '{ "keyBindings": { "newTab": "Shift+A", "nextTab": "Alt+X", "previousTab": "Ctrl+Shift+Left" } }',
    );
    const sessionId = core.state().sessions[0].id;

    expect(core.keyPressed(sessionId, press("A", "KeyA", "shift"))).toBe(false);
    expect(core.keyPressed(sessionId, press("≈", "KeyX", "alt"))).toBe(false);
    expect(effects).toEqual([{ type: "settingsRejected", settings: ["keyBindings.newTab", "keyBindings.nextTab"] }]);
  });

  it("reject key bindings that aren't an object, keeping every default", () => {
    const { core, effects } = startCore(undefined, '{ "keyBindings": ["Cmd+K"] }');

    expect(core.keyPressed(core.state().sessions[0].id, press("k", "KeyK", "meta"))).toBe(true);
    expect(effects[0]).toEqual({ type: "settingsRejected", settings: ["keyBindings"] });
  });
});

describe("terminal input", () => {
  it("searches the focused Pane's scrollback with Cmd+F", () => {
    const { core, effects, sessionId, topRight } = startWithThreePanes();
    core.focusPane(topRight);

    expect(core.keyPressed(sessionId, press("f", "KeyF", "meta"))).toBe(true);

    expect(effects).toEqual([{ type: "findInPane", sessionId, paneId: topRight }]);
  });

  it("clears the focused Pane's scrollback with Cmd+Shift+K", () => {
    const { core, effects, sessionId, left } = startWithThreePanes();
    core.focusPane(left);

    expect(core.keyPressed(sessionId, press("K", "KeyK", "meta", "shift"))).toBe(true);

    expect(effects).toEqual([{ type: "clearScrollback", sessionId, paneId: left }]);
  });

  it("leaves a cleared Pane's scrollback out of Restore, keeping the other Panes'", () => {
    const before = startWithThreePanes();
    before.core.scrollbackChanged(before.left, "$ ls\r\nsrc");
    before.core.scrollbackChanged(before.topRight, "$ pwd\r\n/Users/me");
    before.core.focusPane(before.left);

    before.core.keyPressed(before.sessionId, press("K", "KeyK", "meta", "shift"));
    const after = startCore(before.stateStore);

    expect(after.core.scrollback(before.left)).toBeUndefined();
    expect(after.core.scrollback(before.topRight)).toEqual({ text: "$ pwd\r\n/Users/me", savedAt: 1_000 });
  });

  it("copies with Cmd+C and pastes with Cmd+V in the Session's window", () => {
    const { core, effects } = startCore();
    const sessionId = core.state().sessions[0].id;

    expect(core.keyPressed(sessionId, press("c", "KeyC", "meta"))).toBe(true);
    expect(core.keyPressed(sessionId, press("v", "KeyV", "meta"))).toBe(true);

    expect(effects).toEqual([
      { type: "copy", sessionId },
      { type: "paste", sessionId },
    ]);
  });
});

describe("a link's target", () => {
  it("finds a relative path from the Pane's working directory, without a line and column after it", () => {
    const { core, shellHost, left, topRight } = startWithThreePanes();
    shellHost.changeWorkingDirectory(left, "/Users/me/code/api");

    expect(core.linkTarget(left, "../web/./src/app.ts:12:3")).toEqual({
      type: "path",
      path: "/Users/me/code/web/src/app.ts",
    });
    expect(core.linkTarget(topRight, "notes.md:7")).toEqual({ type: "path", path: "/Users/me/notes.md" });
  });

  it("takes an absolute path as it is, and a path from ~ from the home directory", () => {
    const { core, shellHost, left } = startWithThreePanes();
    shellHost.changeWorkingDirectory(left, "/Users/me/code/api");

    expect(core.linkTarget(left, "/etc/hosts")).toEqual({ type: "path", path: "/etc/hosts" });
    expect(core.linkTarget(left, "~/notes.md")).toEqual({ type: "path", path: "/Users/me/notes.md" });
    expect(core.linkTarget(left, "~")).toEqual({ type: "path", path: "/Users/me" });
  });

  it("opens a URL as it is", () => {
    const { core, left } = startWithThreePanes();

    expect(core.linkTarget(left, "https://example.com/a:8080")).toEqual({ type: "url", url: "https://example.com/a:8080" });
  });

  it("is absent for a Pane that doesn't exist", () => {
    const { core } = startCore();

    expect(core.linkTarget("pane-404", "notes.md")).toBeUndefined();
  });
});

describe("dismissing the Command Palette", () => {
  it("leaves the app shown over the Current Session", () => {
    const { core, effects } = startCore();

    core.paletteDismissed();

    expect(effects).toEqual([]);
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

describe("renaming a Tab", () => {
  // A Session whose second Tab, which is focused, runs vim.
  function startWithVim() {
    const started = startCore();
    const { core, shellHost } = started;
    const sessionId = core.state().sessions[0].id;
    core.newTab(sessionId);
    const tab = core.state().sessions[0].tabs[1];
    shellHost.changeRunningProgram(tab.panes[0].id, "vim");
    return { ...started, sessionId, tabId: tab.id, paneId: tab.panes[0].id };
  }

  it("asks for a title, suggesting the focused Tab's current title", () => {
    const { core, effects, sessionId, tabId } = startWithVim();

    chooseAction(core, "Rename Tab");
    core.renameTab(tabId, "notes");
    chooseAction(core, "Rename Tab");

    expect(effects).toEqual([
      { type: "askTabTitle", sessionId, tabId, suggestion: "vim" },
      { type: "askTabTitle", sessionId, tabId, suggestion: "notes" },
    ]);
  });

  it("fixes the title, whatever the Pane runs or wherever it moves", () => {
    const { core, shellHost, tabId, paneId } = startWithVim();

    core.renameTab(tabId, "notes");
    shellHost.changeRunningProgram(paneId, undefined);
    shellHost.changeWorkingDirectory(paneId, "/Users/me/code/api");

    expect(core.tabTitle(tabId)).toBe("notes");
  });

  it("goes back to the live title once cleared, by the action or by a blank title", () => {
    const { core, tabId } = startWithVim();

    core.renameTab(tabId, "notes");
    chooseAction(core, "Clear Tab Title");
    expect(core.tabTitle(tabId)).toBe("vim");

    core.renameTab(tabId, "notes");
    core.renameTab(tabId, "  ");
    expect(core.tabTitle(tabId)).toBe("vim");
  });

  it("keeps the fixed title through Restore", () => {
    const before = startWithVim();
    before.core.renameTab(before.tabId, "notes");

    const after = startCore(before.stateStore);

    expect(after.core.tabTitle(before.tabId)).toBe("notes");
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

  it("leaves the app shown over the Current Session when cancelled", () => {
    const { core, effects } = startCore();
    core.quitRequested();

    core.quitCancelled();

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

describe("the config file", () => {
  // Sessions `b`, then `a`, so the cycle order shows whether `created` took effect.
  function startWithTwoSessions() {
    const started = startCore();
    const { core } = started;
    core.renameSession(core.state().sessions[0].id, "b");
    core.newSession();
    core.renameSession(core.state().sessions[1].id, "a");
    started.effects.length = 0;
    return started;
  }

  function names(core: ReturnType<typeof startCore>["core"]) {
    return core.sessionsInCycleOrder().map((session) => session.name);
  }

  it("accepts comments and trailing commas, leaving comment markers inside strings alone", () => {
    const { core, effects } = startWithTwoSessions();

    core.configChanged(`{
      // How Sessions are cycled.
      "cycleOrder": /* by creation */ "created",
      "shell": "/opt/homebrew/bin/fish // not a comment",
    }`);

    expect(names(core)).toEqual(["b", "a"]);
    expect(effects).toEqual([]);
  });

  it("falls back to the default for an invalid value, telling the user which settings were rejected", () => {
    const { core, effects } = startWithTwoSessions();

    core.configChanged('{ "cycleOrder": "random", "colour": "blue" }');

    expect(names(core)).toEqual(["a", "b"]);
    expect(effects).toEqual([{ type: "settingsRejected", settings: ["cycleOrder", "colour"] }]);
  });

  // A save caught halfway through an edit mustn't reset every setting, e.g. shrinking unlimited scrollback.
  it("keeps the settings from before for a file that isn't a JSON object, telling the user", () => {
    for (const config of ['{ "cycleOrder": "created" ', '["created"]', "null"]) {
      const { core, effects } = startWithTwoSessions();
      core.configChanged('{ "cycleOrder": "created", "scrollbackLines": "unlimited" }');

      core.configChanged(config);

      expect(names(core)).toEqual(["b", "a"]);
      expect(core.settings().scrollbackLines).toBe(1_000_000);
      expect(effects).toEqual([{ type: "configUnreadable" }]);
    }
  });

  it("starts with every default when the file can't be read at launch, telling the user", () => {
    const { core, effects } = startCore(undefined, "{ broken");

    expect(core.settings().cycleOrder).toBe("alphabetical");
    expect(effects).toEqual([{ type: "configUnreadable" }]);
  });

  it("keeps the settings from before when the file exists but can't be opened, telling the user", () => {
    const { core, effects } = startWithTwoSessions();
    core.configChanged('{ "cycleOrder": "created" }');

    core.configUnreadable();

    expect(names(core)).toEqual(["b", "a"]);
    expect(effects).toEqual([{ type: "configUnreadable" }]);
  });
});

describe("the shell setting", () => {
  it("starts restored Shells with the configured shell", () => {
    const before = startCore();
    before.core.newSession();

    const { shellHost } = startCore(before.stateStore, '{ "shell": "/opt/homebrew/bin/fish" }');

    expect(shellHost.started.map((started) => started.shell)).toEqual([
      "/opt/homebrew/bin/fish",
      "/opt/homebrew/bin/fish",
    ]);
  });

  it("starts new Shells with the shell configured at the time, leaving running ones alone", () => {
    const { core, shellHost } = startCore();
    const sessionId = core.state().sessions[0].id;

    core.configChanged('{ "shell": "/bin/bash" }');
    core.newTab(sessionId);
    core.configChanged(undefined);
    core.splitPane(sessionId, "vertical");

    expect(shellHost.started.map((started) => started.shell)).toEqual([undefined, "/bin/bash", undefined]);
    expect(shellHost.stopped).toEqual([]);
  });

  it("rejects a shell that isn't a non-empty string, starting the login shell instead", () => {
    const { core, shellHost, effects } = startCore(undefined, '{ "shell": " " }');

    core.configChanged('{ "shell": 42 }');

    expect(shellHost.started[0].shell).toBeUndefined();
    expect(effects).toEqual([
      { type: "settingsRejected", settings: ["shell"] },
      { type: "settingsRejected", settings: ["shell"] },
    ]);
  });
});

describe("the scrollback lines setting", () => {
  // Reports `count` numbered lines as the first Pane's scrollback and answers the lines kept.
  function reportLines(core: ReturnType<typeof startCore>["core"], count: number) {
    const paneId = core.state().sessions[0].tabs[0].panes[0].id;
    core.scrollbackChanged(paneId, Array.from({ length: count }, (_, index) => `line ${index + 1}`).join("\r\n"));
    return core.scrollback(paneId)!.text.split("\r\n");
  }

  it("caps each Pane's scrollback at the configured number of lines from the next report on", () => {
    const { core } = startCore();

    core.configChanged('{ "scrollbackLines": 3 }');

    expect(reportLines(core, 5)).toEqual(["line 3", "line 4", "line 5"]);
    expect(core.settings().scrollbackLines).toBe(3);
  });

  it("keeps up to 1,000,000 lines when unlimited", () => {
    const { core } = startCore(undefined, '{ "scrollbackLines": "unlimited" }');

    expect(reportLines(core, 10_005)).toHaveLength(10_005);
    expect(core.settings().scrollbackLines).toBe(1_000_000);
  });

  it("rejects anything but a whole number from 0 to 1,000,000 or unlimited, keeping 10,000 lines", () => {
    for (const lines of ["-1", "2.5", '"lots"', "1000001"]) {
      const { core, effects } = startCore(undefined, `{ "scrollbackLines": ${lines} }`);

      expect(reportLines(core, 10_005)).toHaveLength(10_000);
      expect(effects).toEqual([{ type: "settingsRejected", settings: ["scrollbackLines"] }]);
    }
  });
});

describe("Themes", () => {
  it("starts with the Default Theme, the iTerm2 profile's font, steady block cursor and colours", () => {
    const { core } = startCore();

    expect(core.theme()).toMatchObject({
      name: "Default",
      font: { family: "Andale Mono", size: 14 },
      cursor: { style: "block", blink: false },
      terminal: {
        foreground: "#bbbbbb",
        background: "#000000",
        cursor: "#bbbbbb",
        cursorText: "#ffffff",
        selection: "#b5d5ff",
        selectionText: "#000000",
        black: "#000000",
        red: "#bb0000",
        green: "#00bb00",
        yellow: "#bbbb00",
        blue: "#0000bb",
        magenta: "#bb00bb",
        cyan: "#00bbbb",
        white: "#bbbbbb",
        brightBlack: "#555555",
        brightRed: "#ff5555",
        brightGreen: "#55ff55",
        brightYellow: "#ffff55",
        brightBlue: "#5555ff",
        brightMagenta: "#ff55ff",
        brightCyan: "#55ffff",
        brightWhite: "#ffffff",
      },
    });
  });

  it("applies the Theme the config file's theme setting names, edited by hand", () => {
    const { core, effects } = startCore();

    core.configChanged('{ "theme": "Tokyo Night" }');

    expect(core.theme()).toMatchObject({ name: "Tokyo Night", terminal: { background: "#1a1b26" } });
    expect(effects).toEqual([{ type: "applyTheme", theme: expect.objectContaining({ name: "Tokyo Night" }) }]);
  });

  it("matches the theme setting to a Theme's name ignoring case, as Theme names are unique", () => {
    const { core, effects } = startCore(undefined, '{ "theme": "rosé PINE" }');

    expect(core.theme().name).toBe("Rosé Pine");
    expect(core.settings().theme).toBe("Rosé Pine");
    expect(effects).toEqual([{ type: "applyTheme", theme: expect.objectContaining({ name: "Rosé Pine" }) }]);
  });

  it("falls back to the Default Theme for a theme setting that names no Theme, telling the user", () => {
    const { core, effects } = startCore(undefined, '{ "theme": "Gruvbox" }');
    effects.length = 0;

    core.configChanged('{ "theme": "Dracula", "cycleOrder": "random" }');

    expect(core.theme().name).toBe("Default");
    expect(effects).toEqual([
      { type: "settingsRejected", settings: ["theme", "cycleOrder"] },
      { type: "applyTheme", theme: expect.objectContaining({ name: "Default" }) },
    ]);
  });

  it("lists the built-in Themes, the Default Theme first, then the Theme files' Themes by name", () => {
    const { core } = startCore();

    core.themeFilesChanged([
      { fileName: "nord.jsonc", text: '{ "name": "Nord" }' },
      { fileName: "dracula.jsonc", text: '{ "name": "Dracula" }' },
    ]);

    expect(summarize(core.themeResults(""))).toEqual([
      "theme Default",
      "theme Catppuccin",
      "theme Tokyo Night",
      "theme Rosé Pine",
      "theme Gruvbox",
      "theme Dracula",
      "theme Nord",
    ]);
    expect(summarize(core.themeResults("no"))).toEqual(["theme Nord"]);
  });

  it("takes the Default Theme's value for anything a Theme file leaves out", () => {
    const { core, effects } = startCore();

    core.themeFilesChanged([
      {
        fileName: "dracula.jsonc",
        text: `{
          // Only what differs from the Default Theme.
          "$schema": "./theme.schema.json",
          "name": "Dracula",
          "font": { "size": 13 },
          "terminal": { "background": "#282a36", "foreground": "#f8f8f2" },
          "chrome": { "divider": "#44475a80" },
        }`,
      },
    ]);
    core.configChanged('{ "theme": "Dracula" }');

    expect(core.theme()).toEqual({
      name: "Dracula",
      font: { family: "Andale Mono", size: 13 },
      cursor: { style: "block", blink: false },
      terminal: { ...defaultTheme.terminal, background: "#282a36", foreground: "#f8f8f2" },
      chrome: { ...defaultTheme.chrome, divider: "#44475a80" },
    });
    expect(effects).toEqual([{ type: "applyTheme", theme: core.theme() }]);
  });

  it("takes the Default Theme's value for anything a Theme file gives an invalid value or doesn't define, telling the user", () => {
    const { core, effects } = startCore();
    const dracula = {
      name: "Dracula",
      font: { family: " ", size: 100 },
      cursor: { style: "beam", blink: true },
      terminal: { background: "#282a36", foreground: "white", selection: "#44475a80", purple: "#bd93f9" },
      chrome: "dark",
      opacity: 0.9,
    };

    core.themeFilesChanged([{ fileName: "dracula.jsonc", text: JSON.stringify(dracula) }]);
    core.configChanged('{ "theme": "Dracula" }');

    expect(core.theme()).toEqual({
      name: "Dracula",
      font: { family: "Andale Mono", size: 14 },
      cursor: { style: "block", blink: true },
      terminal: { ...defaultTheme.terminal, background: "#282a36", selection: "#44475a80" },
      chrome: defaultTheme.chrome,
    });
    expect(effects[0]).toEqual({
      type: "themesRejected",
      rejected: [
        "dracula.jsonc: font.family",
        "dracula.jsonc: font.size",
        "dracula.jsonc: cursor.style",
        "dracula.jsonc: terminal.foreground",
        "dracula.jsonc: terminal.purple",
        "dracula.jsonc: chrome",
        "dracula.jsonc: opacity",
      ],
    });
  });

  it("skips a Theme file that isn't a JSON object or whose name is missing or taken, ignoring case, telling the user", () => {
    const { core, effects } = startCore();

    core.themeFilesChanged([
      { fileName: "nord-copy.jsonc", text: '{ "name": "NORD" }' },
      { fileName: "nord.jsonc", text: '{ "name": "Nord" }' },
      { fileName: "half-saved.jsonc", text: '{ "name": "Dracula", ' },
      { fileName: "list.jsonc", text: '["Dracula"]' },
      { fileName: "nameless.jsonc", text: '{ "terminal": {} }' },
      { fileName: "blank.jsonc", text: '{ "name": " " }' },
      { fileName: "gruvbox.jsonc", text: '{ "name": "gruvbox" }' },
    ]);

    expect(summarize(core.themeResults("")).slice(5)).toEqual(["theme NORD"]);
    expect(effects).toEqual([
      {
        type: "themesRejected",
        rejected: ["blank.jsonc", "gruvbox.jsonc", "half-saved.jsonc", "list.jsonc", "nameless.jsonc", "nord.jsonc"],
      },
    ]);
  });

  it("applies the Theme the setting names once its file appears, and falls back once it goes, telling the user", () => {
    const { core, effects } = startCore(undefined, '{ "theme": "Dracula", "scrollbackLines": 5 }');
    const dracula = { fileName: "dracula.jsonc", text: '{ "name": "Dracula" }' };
    effects.length = 0;

    core.themeFilesChanged([dracula]);
    expect(core.theme().name).toBe("Dracula");
    core.themeFilesChanged([dracula]);
    core.themeFilesChanged([]);

    expect(core.theme().name).toBe("Default");
    expect(core.settings().scrollbackLines).toBe(5);
    expect(effects).toEqual([
      { type: "applyTheme", theme: expect.objectContaining({ name: "Dracula" }) },
      { type: "settingsRejected", settings: ["theme"] },
      { type: "applyTheme", theme: expect.objectContaining({ name: "Default" }) },
    ]);
  });

  it("choosing Change Theme asks for a Theme, with or without a Current Session, keeping the app shown", () => {
    const { core, effects, shellHost } = startCore(undefined, '{ "hotkeyWithNoOpenSessions": "palette" }');
    const sessionId = core.state().sessions[0].id;

    chooseAction(core, "Change Theme");
    shellHost.exit(core.state().sessions[0].tabs[0].panes[0].id);
    core.hotkeyPressed();
    chooseAction(core, "Change Theme");

    expect(effects).toEqual([
      { type: "pickTheme", sessionId },
      { type: "closeWindow", sessionId },
      { type: "hideApp" },
      { type: "showPalette" },
      { type: "pickTheme" },
    ]);
  });

  it("previews each Theme browsed, restoring the Theme from before when the Command Palette is dismissed", () => {
    const { core, effects } = startCore(undefined, '{ "theme": "Catppuccin" }');
    effects.length = 0;

    core.previewTheme("Gruvbox");
    core.previewTheme("Tokyo Night");
    core.previewTheme("Dracula");
    expect(core.theme().name).toBe("Tokyo Night");
    core.paletteDismissed();

    expect(core.theme().name).toBe("Catppuccin");
    expect(core.settings().theme).toBe("Catppuccin");
    expect(effects).toEqual([
      { type: "applyTheme", theme: expect.objectContaining({ name: "Gruvbox" }) },
      { type: "applyTheme", theme: expect.objectContaining({ name: "Tokyo Night" }) },
      { type: "applyTheme", theme: expect.objectContaining({ name: "Catppuccin" }) },
    ]);
  });

  it("shows the setting's Theme once the previewed Theme's file goes, and choosing that Theme then ends the preview", () => {
    const { core, effects } = startCore(undefined, '{ "theme": "Catppuccin" }');
    const nord = { fileName: "nord.jsonc", text: '{ "name": "Nord" }' };
    core.themeFilesChanged([nord]);

    core.previewTheme("Nord");
    core.themeFilesChanged([]);
    expect(core.theme().name).toBe("Catppuccin");
    chooseTheme(core, "Nord");
    core.themeFilesChanged([nord]);

    expect(core.theme().name).toBe("Catppuccin");
    expect((effects as Effect[]).some((effect) => effect.type === "writeConfig")).toBe(false);
  });

  it("choosing a Theme keeps it, setting it in the config file with the file's comments and other settings kept", () => {
    const { core, effects } = startCore(
      undefined,
      `{
  // Mine.
  "theme": /* was */ "Catppuccin",
  "cycleOrder": "created",
}
`,
    );
    effects.length = 0;

    core.previewTheme("Gruvbox");
    core.choosePaletteResult(core.themeResults("gruv")[0]);
    const written = `{
  // Mine.
  "theme": /* was */ "Gruvbox",
  "cycleOrder": "created",
}
`;
    core.configChanged(written);

    expect(core.theme().name).toBe("Gruvbox");
    expect(core.settings().theme).toBe("Gruvbox");
    expect(effects).toEqual([
      { type: "applyTheme", theme: expect.objectContaining({ name: "Gruvbox" }) },
      { type: "writeConfig", text: written },
    ]);
  });

  it("choosing a Theme adds the theme setting to a config file without it, or writes a file with it when there's none", () => {
    const { core, effects } = startCore(undefined, '{\n  // Mine.\n    "cycleOrder": "created" // by creation\n}\n');
    const writes = () => (effects as Effect[]).flatMap((effect) => (effect.type === "writeConfig" ? [effect.text] : []));

    chooseTheme(core, "Gruvbox");
    core.configChanged(undefined);
    chooseTheme(core, "Rosé Pine");
    core.configChanged("{}");
    chooseTheme(core, "Catppuccin");

    expect(writes()).toEqual([
      '{\n  // Mine.\n    "cycleOrder": "created", // by creation\n    "theme": "Gruvbox"\n}\n',
      `{
  // Your editor suggests every setting and its default from the schema.
  "$schema": "./config.schema.json",
  "theme": "Rosé Pine"
}
`,
      '{\n  "theme": "Catppuccin"\n}',
    ]);
  });

  it("keeps the Theme chosen when the Theme files change before the config file is read again", () => {
    const { core } = startCore(undefined, '{ "theme": "Catppuccin" }');

    chooseTheme(core, "Gruvbox");
    core.themeFilesChanged([{ fileName: "nord.jsonc", text: '{ "name": "Nord" }' }]);

    expect(core.theme().name).toBe("Gruvbox");
  });

  // A save caught halfway through an edit mustn't be written over with the settings from before it.
  it("choosing a Theme while the config file can't be read applies it without writing the file, telling the user", () => {
    const { core, effects } = startCore(undefined, '{ "cycleOrder": "created" }');

    core.configChanged('{ "cycleOrder": ');
    effects.length = 0;
    chooseTheme(core, "Gruvbox");
    core.configUnreadable();
    chooseTheme(core, "Catppuccin");

    expect(core.theme().name).toBe("Catppuccin");
    expect(effects).toEqual([
      { type: "applyTheme", theme: expect.objectContaining({ name: "Gruvbox" }) },
      { type: "configUnreadable" },
      { type: "configUnreadable" },
      { type: "applyTheme", theme: expect.objectContaining({ name: "Catppuccin" }) },
      { type: "configUnreadable" },
    ]);
  });

  it("keeps the Theme chosen while the config file can't be read when the Theme files change", () => {
    const { core } = startCore(undefined, '{ "theme": "Tokyo Night" }');
    core.configUnreadable();

    chooseTheme(core, "Gruvbox");
    core.themeFilesChanged([{ fileName: "nord.jsonc", text: '{ "name": "Nord" }' }]);

    expect(core.theme().name).toBe("Gruvbox");
  });
});

// Relaunches from the saved snapshot with each Session changed by `update`, standing in for what later commands do,
// such as closing a Session with its Tabs or setting its Root directory.
function relaunchWith(stateStore: StateStore, update: (session: Session) => Session) {
  const { state, scrollback } = stateStore.load()!;
  stateStore.save({ state: { ...state, sessions: state.sessions.map(update) }, scrollback });
  return startCore(stateStore);
}

describe("reopening a Closed Session", () => {
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

describe("renaming a Session", () => {
  it("asks for a name, suggesting the current Pane's folder name", () => {
    const { core, shellHost, effects } = startCore();
    const sessionId = core.state().sessions[0].id;
    shellHost.changeWorkingDirectory(core.state().sessions[0].tabs[0].panes[0].id, "/some/dir/somewhere");

    chooseAction(core, "Rename Session");

    expect(effects).toEqual([{ type: "askSessionName", sessionId, suggestion: "somewhere" }]);
  });

  // Sessions named `api` and `api 2`, and an Unnamed Session at ~/code/api, which is current.
  function startWithTakenNames() {
    const started = startCore();
    const { core, shellHost } = started;
    core.renameSession(core.state().sessions[0].id, "api");
    core.newSession();
    core.renameSession(core.state().sessions[1].id, "api 2");
    core.newSession();
    const unnamed = core.state().sessions[2];
    shellHost.changeWorkingDirectory(unnamed.tabs[0].panes[0].id, "/Users/me/code/api");
    started.effects.length = 0;
    return { ...started, unnamed: unnamed.id };
  }

  it("suggests the folder name with the next free number when other Sessions hold it", () => {
    const { core, effects, unnamed } = startWithTakenNames();

    chooseAction(core, "Rename Session");

    expect(effects).toEqual([{ type: "askSessionName", sessionId: unnamed, suggestion: "api 3" }]);
  });

  it("suggests the Session's own name without a number", () => {
    const { core, shellHost, effects } = startCore();
    const session = core.state().sessions[0];
    shellHost.changeWorkingDirectory(session.tabs[0].panes[0].id, "/Users/me/code/api");
    core.renameSession(session.id, "api");

    chooseAction(core, "Rename Session");

    expect(effects).toEqual([{ type: "askSessionName", sessionId: session.id, suggestion: "api" }]);
  });

  it("gives a name another Session holds the next free number, keeping names unique", () => {
    const { core, unnamed } = startWithTakenNames();

    core.renameSession(unnamed, "api");

    expect(core.state().sessions.map((session) => session.name)).toEqual(["api", "api 2", "api 3"]);
  });

  it("keeps a Session's name when it's renamed to the name it already has", () => {
    const { core } = startWithTakenNames();

    core.renameSession(core.state().sessions[1].id, "api 2");

    expect(core.state().sessions[1].name).toBe("api 2");
  });

  it("ignores a blank name, leaving the Session as it was", () => {
    const { core, unnamed } = startWithTakenNames();

    core.renameSession(unnamed, "   ");

    expect(core.sessionLabel(unnamed)).toBe("Session 1 (~/code/api)");
  });
});

describe("a Session's Root directory", () => {
  // The Session's Root directory set at ~/code/api, with its Pane moved on to ~/code/api/src.
  function startWithRoot() {
    const started = startCore();
    const { core, shellHost } = started;
    const session = core.state().sessions[0];
    const paneId = session.tabs[0].panes[0].id;
    shellHost.changeWorkingDirectory(paneId, "/Users/me/code/api");
    chooseAction(core, "Set Session Root");
    shellHost.changeWorkingDirectory(paneId, "/Users/me/code/api/src");
    return { ...started, sessionId: session.id };
  }

  it("is set to the current Pane's working directory", () => {
    const { core } = startWithRoot();

    expect(core.state().sessions[0].rootDirectory).toBe("/Users/me/code/api");
  });

  it("is where new Tabs start once set", () => {
    const { core, shellHost, sessionId } = startWithRoot();

    core.newTab(sessionId);

    const tab = core.state().sessions[0].tabs[1];
    expect(tab.panes[0].workingDirectory).toBe("/Users/me/code/api");
    expect(shellHost.started.at(-1)).toEqual({ paneId: tab.panes[0].id, workingDirectory: "/Users/me/code/api" });
  });

  it("doesn't change where splits start, which is the current Pane's working directory", () => {
    const { core, shellHost, sessionId } = startWithRoot();

    core.splitPane(sessionId, "vertical");

    expect(shellHost.started.at(-1)?.workingDirectory).toBe("/Users/me/code/api/src");
  });

  it("once cleared, is gone, and new Tabs start in the current Pane's working directory again", () => {
    const { core, shellHost, sessionId } = startWithRoot();

    chooseAction(core, "Clear Session Root");
    core.newTab(sessionId);

    expect(core.state().sessions[0].rootDirectory).toBeUndefined();
    expect(shellHost.started.at(-1)?.workingDirectory).toBe("/Users/me/code/api/src");
  });
});

describe("closing a Session", () => {
  // A Session with two Tabs, the first split in two with scrollback in its left Pane, and a second Session, created
  // later, that is current. The first Session is made current again.
  function startWithSessionToClose() {
    const started = startWithThreePanes();
    const { core, clock, sessionId, left } = started;
    core.closePane(sessionId);
    core.newTab(sessionId);
    core.scrollbackChanged(left, "$ ls\r\nsrc");
    clock.advance(1_000);
    core.newSession();
    const other = core.state().sessions[1].id;
    clock.advance(1_000);
    core.focusNextSession();
    started.shellHost.stopped.length = 0;
    started.effects.length = 0;
    return { ...started, other, saved: core.state().sessions[0] };
  }

  it("makes it a Closed Session that keeps its Tabs and Panes, stopping every Shell and closing its window", () => {
    const { core, shellHost, effects, sessionId, saved, other } = startWithSessionToClose();

    chooseAction(core, "Close Session");

    expect(core.state().sessions[0]).toEqual({ ...saved, status: "closed" });
    expect(shellHost.stopped).toEqual(saved.tabs.flatMap((tab) => tab.panes.map((pane) => pane.id)));
    expect(core.state().currentSessionId).toBe(other);
    expect(effects).toEqual([
      { type: "closeWindow", sessionId },
      { type: "showSession", sessionId: other },
    ]);
  });

  it("ignores what the stopped Shells report afterwards", () => {
    const { core, shellHost, sessionId, saved } = startWithSessionToClose();
    core.closeSession(sessionId);
    const announced: unknown[] = [];
    core.onStateChange((state) => announced.push(state));

    for (const pane of saved.tabs.flatMap((tab) => tab.panes)) {
      shellHost.changeWorkingDirectory(pane.id, "/tmp");
      shellHost.exit(pane.id);
    }

    expect(announced).toEqual([]);
    expect(core.state().sessions[0]).toEqual({ ...saved, status: "closed" });
  });

  it("brings back its Tabs, Panes and scrollback when reopened", () => {
    const { core, shellHost, clock, sessionId, saved, left } = startWithSessionToClose();
    core.closeSession(sessionId);
    clock.advance(1_000);

    core.reopenSession(sessionId);

    expect(core.state().sessions[0]).toEqual({ ...saved, lastUsedAt: 4_000 });
    expect(shellHost.started.slice(-3).map((started) => started.paneId)).toEqual(
      saved.tabs.flatMap((tab) => tab.panes.map((pane) => pane.id)),
    );
    expect(core.scrollback(left)).toEqual({ text: "$ ls\r\nsrc", savedAt: 1_000 });
  });

  it("as the last Open Session, leaves no Current Session and hides the app", () => {
    const { core, effects } = startCore();
    const sessionId = core.state().sessions[0].id;

    core.closeSession(sessionId);

    expect(core.state().currentSessionId).toBeUndefined();
    expect(effects).toEqual([{ type: "closeWindow", sessionId }, { type: "hideApp" }]);
  });
});

describe("deleting a Session", () => {
  it("asks for confirmation, leaving the Session as it was", () => {
    const { core, shellHost, effects } = startCore();
    const before = core.state();

    chooseAction(core, "Delete Session");

    expect(effects).toEqual([{ type: "confirmDelete", sessionId: before.sessions[0].id }]);
    expect(core.state()).toBe(before);
    expect(shellHost.stopped).toEqual([]);
  });

  it("once confirmed, removes an Open Session for good, stopping its Shells and closing its window", () => {
    const before = startWithThreePanes();
    const { core, shellHost, effects, sessionId, left, topRight, bottomRight } = before;
    core.scrollbackChanged(left, "$ ls");
    core.newSession();
    const other = core.state().sessions[1].id;
    core.focusNextSession();
    effects.length = 0;

    core.deleteConfirmed(sessionId);

    expect(core.state().sessions.map((session) => session.id)).toEqual([other]);
    expect(core.state().currentSessionId).toBe(other);
    expect(shellHost.stopped).toEqual([left, topRight, bottomRight]);
    expect(effects).toEqual([
      { type: "closeWindow", sessionId },
      { type: "showSession", sessionId: other },
    ]);
    const after = startCore(before.stateStore);
    expect(after.core.state().sessions.map((session) => session.id)).toEqual([other]);
    expect(after.core.scrollback(left)).toBeUndefined();
  });

  it("never announces a state whose Current Session is gone", () => {
    const { core } = startCore();
    const deleted = core.state().sessions[0].id;
    core.newSession();
    core.focusNextSession();
    const currentSessionIds: unknown[] = [];
    core.onStateChange((state) => currentSessionIds.push(state.currentSessionId));

    core.deleteConfirmed(deleted);

    expect(currentSessionIds).not.toContain(deleted);
    expect(currentSessionIds.at(-1)).toBe(core.state().sessions[0].id);
  });

  it("once confirmed, removes a Closed Session without anything to stop or close", () => {
    const { core, shellHost, effects } = startCore();
    const closed = core.state().sessions[0];
    core.newSession();
    shellHost.exit(closed.tabs[0].panes[0].id);
    effects.length = 0;

    core.deleteConfirmed(closed.id);

    expect(core.state().sessions).toHaveLength(1);
    expect(shellHost.stopped).toEqual([]);
    expect(effects).toEqual([]);
  });

  it("frees an Unnamed Session's label number", () => {
    const { core } = startCore();
    const first = core.state().sessions[0].id;
    core.newSession();
    core.deleteConfirmed(first);

    core.newSession();

    expect(core.sessionLabel(core.state().sessions[1].id)).toBe("Session 1 (~)");
  });
});

describe("the Command Palette", () => {
  // `web` with a Tab at ~/code/web and a second Tab split in two at ~/code/web/src, the right Pane running vim; `api`
  // at ~/code/api; `old`, closed through its last Tab; and an Unnamed Session at the home directory, which is current.
  function startWithPaletteSessions() {
    const started = startCore();
    const { core, shellHost, clock } = started;
    const web = core.state().sessions[0].id;
    core.renameSession(web, "web");
    shellHost.changeWorkingDirectory(core.state().sessions[0].tabs[0].panes[0].id, "/Users/me/code/web");
    core.newTab(web);
    shellHost.changeWorkingDirectory(core.state().sessions[0].tabs[1].panes[0].id, "/Users/me/code/web/src");
    core.splitPane(web, "vertical");
    shellHost.changeRunningProgram(core.state().sessions[0].tabs[1].panes[1].id, "vim");
    for (const name of ["api", "old", undefined]) {
      clock.advance(1_000);
      core.newSession();
      if (name) core.renameSession(core.state().sessions.at(-1)!.id, name);
    }
    const [, api, old, unnamed] = core.state().sessions.map((session) => session.id);
    shellHost.changeWorkingDirectory(core.state().sessions[1].tabs[0].panes[0].id, "/Users/me/code/api");
    shellHost.exit(core.state().sessions[2].tabs[0].panes[0].id);
    started.effects.length = 0;
    return { ...started, web, api, old, unnamed };
  }

  it("narrows to every Session with `ss `, Open and Closed, in cycle order, marking the Closed ones", () => {
    const { core, web, api, old, unnamed } = startWithPaletteSessions();

    expect(core.paletteResults("ss ")).toEqual([
      { type: "session", sessionId: api, label: "api", closed: false },
      { type: "session", sessionId: old, label: "old", closed: true },
      { type: "session", sessionId: web, label: "web", closed: false },
      { type: "session", sessionId: unnamed, label: "Session 1 (~)", closed: false },
    ]);

    core.configChanged('{ "cycleOrder": "created" }');
    expect(summarize(core.paletteResults("ss "))).toEqual([
      "session web",
      "session api",
      "session old",
      "session Session 1 (~)",
    ]);
  });

  it("narrows to the Tabs of Open Sessions with `tt `, by their titles, Session by Session in cycle order", () => {
    const { core } = startWithPaletteSessions();
    const [web, api, , unnamed] = core.state().sessions;

    expect(core.paletteResults("tt ")).toEqual([
      { type: "tab", tabId: api.tabs[0].id, label: "api", sessionLabel: "api" },
      { type: "tab", tabId: web.tabs[0].id, label: "web", sessionLabel: "web" },
      { type: "tab", tabId: web.tabs[1].id, label: "vim", sessionLabel: "web" },
      { type: "tab", tabId: unnamed.tabs[0].id, label: "me", sessionLabel: "Session 1 (~)" },
    ]);
  });

  it("narrows to the Panes of Open Sessions with `pp `, by running program or folder name, with their directories", () => {
    const { core } = startWithPaletteSessions();
    const [web, api, , unnamed] = core.state().sessions;
    const pane = (id: string, label: string, workingDirectory: string, sessionLabel: string) => ({
      type: "pane",
      paneId: id,
      label,
      workingDirectory,
      sessionLabel,
    });

    expect(core.paletteResults("pp ")).toEqual([
      pane(api.tabs[0].panes[0].id, "api", "~/code/api", "api"),
      pane(web.tabs[0].panes[0].id, "web", "~/code/web", "web"),
      pane(web.tabs[1].panes[0].id, "src", "~/code/web/src", "web"),
      pane(web.tabs[1].panes[1].id, "vim", "~/code/web/src", "web"),
      pane(unnamed.tabs[0].panes[0].id, "me", "~", "Session 1 (~)"),
    ]);
  });

  it("without a prefix, offers every Session, then every Tab and Pane of Open Sessions, then every app action", () => {
    const { core } = startWithPaletteSessions();

    expect(summarize(core.paletteResults(""))).toEqual([
      "session api",
      "session old",
      "session web",
      "session Session 1 (~)",
      "tab api",
      "tab web",
      "tab vim",
      "tab me",
      "pane api",
      "pane web",
      "pane src",
      "pane vim",
      "pane me",
      "action New Session",
      "action Rename Session",
      "action Set Session Root",
      "action Clear Session Root",
      "action Close Session",
      "action Delete Session",
      "action New Tab",
      "action Rename Tab",
      "action Clear Tab Title",
      "action Split Pane Vertically",
      "action Split Pane Horizontally",
      "action Close Pane",
      "action Next Session",
      "action Previous Session",
      "action Next Tab",
      "action Previous Tab",
      "action Next Pane",
      "action Previous Pane",
      "action Focus Pane Left",
      "action Focus Pane Right",
      "action Focus Pane Above",
      "action Focus Pane Below",
      "action Find in Pane",
      "action Clear Scrollback",
      "action Change Theme",
      "action Change Menu Bar Icon",
      "action Open Settings",
      "action Quit Blind",
    ]);
  });

  it("choosing Open Settings opens the config file, with or without a Current Session", () => {
    const { core, effects, shellHost } = startCore(undefined, '{ "hotkeyWithNoOpenSessions": "palette" }');

    chooseAction(core, "Open Settings");
    shellHost.exit(core.state().sessions[0].tabs[0].panes[0].id);
    core.hotkeyPressed();
    chooseAction(core, "Open Settings");

    expect(effects).toEqual([
      { type: "openSettings" },
      { type: "closeWindow", sessionId: core.state().sessions[0].id },
      { type: "hideApp" },
      { type: "showPalette" },
      { type: "openSettings" },
      { type: "hideApp" },
    ]);
  });

  it("keeps the results whose labels hold the query's letters in order, ignoring case", () => {
    const { core } = startWithPaletteSessions();

    expect(summarize(core.paletteResults("SPLI"))).toEqual([
      "action Split Pane Vertically",
      "action Split Pane Horizontally",
    ]);
  });

  it("matches Tabs by their Session's label too, and Panes by their working directory and Session's label", () => {
    const { core } = startWithPaletteSessions();

    expect(summarize(core.paletteResults("tt web"))).toEqual(["tab web", "tab vim"]);
    expect(summarize(core.paletteResults("pp src"))).toEqual(["pane src", "pane vim"]);
    expect(summarize(core.paletteResults("pp session"))).toEqual(["pane me"]);
  });

  it("ranks letters at word starts and letters in a run above scattered ones, keeping the offered order on ties", () => {
    const { core } = startWithPaletteSessions();

    expect(summarize(core.paletteResults("nt"))).toEqual([
      "action New Tab",
      "action Next Tab",
      "action Split Pane Horizontally",
      "action Rename Tab",
      "action Next Session",
      "action Next Pane",
      "action Change Theme",
      "action Set Session Root",
      "action Clear Session Root",
      "action Split Pane Vertically",
      "action Focus Pane Left",
      "action Focus Pane Right",
      "action Open Settings",
    ]);
    expect(summarize(core.paletteResults("ab"))).toEqual([
      "action Focus Pane Above",
      "action New Tab",
      "action Rename Tab",
      "action Clear Tab Title",
      "action Next Tab",
      "action Previous Tab",
      "action Focus Pane Below",
      "action Change Menu Bar Icon",
      "action Clear Scrollback",
    ]);
  });

  it("choosing a Tab in another Session makes that Session the Current Session with the Tab focused", () => {
    const { core, effects, web } = startWithPaletteSessions();
    const tab = core.paletteResults("tt ").find((result) => result.type === "tab" && result.label === "web")!;

    core.choosePaletteResult(tab);

    expect(core.state().currentSessionId).toBe(web);
    expect(core.state().sessions[0].focusedTabId).toBe(core.state().sessions[0].tabs[0].id);
    expect(effects).toEqual([{ type: "showSession", sessionId: web }]);
  });

  it("choosing a Pane in another Session makes that Session the Current Session with the Pane and its Tab focused", () => {
    const { core, effects, web } = startWithPaletteSessions();
    core.focusTab(web, 0);
    effects.length = 0;
    const pane = core.paletteResults("pp ").find((result) => result.type === "pane" && result.label === "src")!;

    core.choosePaletteResult(pane);

    const session = core.state().sessions[0];
    expect(core.state().currentSessionId).toBe(web);
    expect(session.focusedTabId).toBe(session.tabs[1].id);
    expect(session.tabs[1].focusedPaneId).toBe(session.tabs[1].panes[0].id);
    expect(effects).toEqual([{ type: "showSession", sessionId: web }]);
  });

  it("choosing a Closed Session reopens it as the Current Session", () => {
    const { core, shellHost, effects, old } = startWithPaletteSessions();
    const closed = core.paletteResults("ss old")[0];

    core.choosePaletteResult(closed);

    const session = core.state().sessions[2];
    expect(session.status).toBe("open");
    expect(core.state().currentSessionId).toBe(old);
    expect(shellHost.started.at(-1)).toEqual({ paneId: session.tabs[0].panes[0].id, workingDirectory: "/Users/me" });
    expect(effects).toEqual([{ type: "showSession", sessionId: old }]);
  });

  it("choosing a Closed Session that kept its Tabs brings them back with a Restore", () => {
    const before = startCore();
    const api = before.core.state().sessions[0].id;
    before.core.renameSession(api, "api");
    before.core.splitPane(api, "vertical");
    before.core.newSession();
    const saved = before.core.state().sessions[0];
    const { core, shellHost } = relaunchWith(before.stateStore, (session) =>
      session.id === api ? { ...session, status: "closed" } : session,
    );

    core.choosePaletteResult(core.paletteResults("ss api")[0]);

    expect(core.state().sessions[0]).toEqual({ ...saved, lastUsedAt: 1_000 });
    expect(core.state().currentSessionId).toBe(api);
    expect(shellHost.started.slice(1).map((started) => started.paneId)).toEqual(
      saved.tabs[0].panes.map((pane) => pane.id),
    );
  });

  it("choosing an Open Session makes it the Current Session", () => {
    const { core, effects, api } = startWithPaletteSessions();

    core.choosePaletteResult(core.paletteResults("ss api")[0]);

    expect(core.state().currentSessionId).toBe(api);
    expect(effects).toEqual([{ type: "showSession", sessionId: api }]);
  });

  it("choosing an app action runs it on the Current Session", () => {
    const { core, effects, unnamed } = startWithPaletteSessions();
    const choose = (label: string) =>
      core.choosePaletteResult(core.paletteResults("").find((result) => result.label === label)!);
    const current = () => core.state().sessions.find((session) => session.id === unnamed)!;

    choose("New Tab");
    expect(current().tabs).toHaveLength(2);
    expect(current().focusedTabId).toBe(current().tabs[1].id);

    choose("Split Pane Horizontally");
    expect(current().tabs[1].layout).toMatchObject({ type: "split", direction: "horizontal" });

    choose("Previous Pane");
    expect(current().tabs[1].focusedPaneId).toBe(current().tabs[1].panes[0].id);

    choose("Focus Pane Below");
    expect(current().tabs[1].focusedPaneId).toBe(current().tabs[1].panes[1].id);

    choose("Close Pane");
    expect(current().tabs[1].panes).toHaveLength(1);

    choose("Previous Tab");
    expect(current().focusedTabId).toBe(current().tabs[0].id);

    choose("Next Session");
    expect(core.state().currentSessionId).not.toBe(unnamed);

    choose("New Session");
    expect(core.state().sessions).toHaveLength(5);

    choose("Quit Blind");
    expect(effects.at(-1)).toEqual({ type: "confirmQuit" });
  });
});

describe("the menu bar icon's menu", () => {
  // Each Session as its label, Open and Closed apart.
  function menuLabels(core: ReturnType<typeof startCore>["core"]) {
    const { open, closed } = core.menuBar();
    return { open: open.map((session) => session.label), closed: closed.map((session) => session.label) };
  }

  it("lists the Open Sessions and the Closed Sessions apart, each in cycle order, Unnamed Sessions by their labels", () => {
    const { core, shellHost } = startCore();
    for (const name of ["web", undefined, "api", "zed"]) {
      core.newSession();
      if (name) core.renameSession(core.state().sessions.at(-1)!.id, name);
    }
    const [first, , unnamed, , zed] = core.state().sessions;
    shellHost.changeWorkingDirectory(first.tabs[0].panes[0].id, "/Users/me/code/api");
    core.closeSession(first.id);
    core.closeSession(zed.id);
    shellHost.changeWorkingDirectory(unnamed.tabs[0].panes[0].id, "/tmp");

    expect(menuLabels(core)).toEqual({ open: ["api", "web", "Session 2 (/tmp)"], closed: ["zed", "Session 1 (~/code/api)"] });
  });

  it("shows the app with an Open Session chosen from it as the Current Session", () => {
    const { core, clock, effects } = startCore();
    const first = core.state().sessions[0].id;
    core.newSession();
    core.hotkeyPressed();
    clock.advance(500);
    effects.length = 0;

    core.menuBarSessionChosen(first);

    expect(core.state().currentSessionId).toBe(first);
    expect(core.state().sessions[0].lastUsedAt).toBe(1_500);
    expect(effects).toEqual([{ type: "showApp", sessionId: first }]);
  });

  it("reopens a Closed Session chosen from it with a Restore and shows it, with no Open Sessions left", () => {
    const { core, shellHost, effects } = startCore();
    const session = core.state().sessions[0];
    const paneId = session.tabs[0].panes[0].id;
    shellHost.changeWorkingDirectory(paneId, "/Users/me/code/api");
    core.closeSession(session.id);
    effects.length = 0;

    core.menuBarSessionChosen(session.id);

    expect(core.state().sessions[0].status).toBe("open");
    expect(core.state().currentSessionId).toBe(session.id);
    expect(shellHost.started.at(-1)).toEqual({ paneId, workingDirectory: "/Users/me/code/api" });
    expect(effects).toEqual([{ type: "showApp", sessionId: session.id }]);
  });

  it("swaps in a Session chosen from it while the app is shown", () => {
    const { core, effects } = startCore();
    const first = core.state().sessions[0].id;
    core.newSession();
    effects.length = 0;

    core.menuBarSessionChosen(first);

    expect(core.state().currentSessionId).toBe(first);
    expect(effects).toEqual([{ type: "showSession", sessionId: first }]);
  });

  it("opens a new Session from it and shows the app with it", () => {
    const { core, effects } = startCore();
    core.hotkeyPressed();
    effects.length = 0;

    core.menuBarActionChosen("newSession");

    const session = core.state().sessions[1];
    expect(session.status).toBe("open");
    expect(core.state().currentSessionId).toBe(session.id);
    expect(effects).toEqual([{ type: "showApp", sessionId: session.id }]);
  });

  it("offers New Session, Open Settings and Quit Blind after the Sessions, under their Command Palette labels", () => {
    const { core } = startCore();

    expect(core.menuBar().actions.map((action) => action.label)).toEqual(["New Session", "Open Settings", "Quit Blind"]);
  });

  it("opens the settings and asks before quitting", () => {
    const { core, effects } = startCore();

    core.menuBarActionChosen("openSettings");
    core.menuBarActionChosen("quit");

    expect(effects).toEqual([{ type: "openSettings" }, { type: "confirmQuit" }]);
  });
});

describe("the menu bar icon", () => {
  it("is monochrome by default, and the one the menuBarIcon setting names, edited by hand", () => {
    const { core, effects } = startCore();
    expect(core.menuBarIcon()).toBe("monochrome");

    core.configChanged('{ "menuBarIcon": "colour" }');
    core.configChanged('{ "menuBarIcon": "colour", "cycleOrder": "created" }');

    expect(core.menuBarIcon()).toBe("colour");
    expect(effects).toEqual([{ type: "applyMenuBarIcon", icon: "colour" }]);
  });

  it("falls back to monochrome for a menuBarIcon setting naming no icon, telling the user", () => {
    const { core, effects } = startCore(undefined, '{ "menuBarIcon": "colour" }');
    effects.length = 0;

    core.configChanged('{ "menuBarIcon": "rainbow" }');

    expect(core.menuBarIcon()).toBe("monochrome");
    expect(effects).toEqual([
      { type: "settingsRejected", settings: ["menuBarIcon"] },
      { type: "applyMenuBarIcon", icon: "monochrome" },
    ]);
  });

  it("choosing Change Menu Bar Icon asks for an icon, with or without a Current Session, keeping the app shown", () => {
    const { core, effects, shellHost } = startCore(undefined, '{ "hotkeyWithNoOpenSessions": "palette" }');
    const sessionId = core.state().sessions[0].id;

    chooseAction(core, "Change Menu Bar Icon");
    shellHost.exit(core.state().sessions[0].tabs[0].panes[0].id);
    core.hotkeyPressed();
    chooseAction(core, "Change Menu Bar Icon");

    expect(effects).toEqual([
      { type: "pickMenuBarIcon", sessionId },
      { type: "closeWindow", sessionId },
      { type: "hideApp" },
      { type: "showPalette" },
      { type: "pickMenuBarIcon" },
    ]);
  });

  it("lists the icons, previewing each one browsed and restoring the one from before when the Command Palette is dismissed", () => {
    const { core, effects } = startCore(undefined, '{ "menuBarIcon": "colour" }');
    effects.length = 0;

    expect(summarize(core.menuBarIconResults(""))).toEqual(["menuBarIcon Monochrome", "menuBarIcon Colour"]);
    expect(summarize(core.menuBarIconResults("col"))).toEqual(["menuBarIcon Colour"]);
    core.previewMenuBarIcon("monochrome");
    expect(core.menuBarIcon()).toBe("monochrome");
    core.paletteDismissed();

    expect(core.menuBarIcon()).toBe("colour");
    expect(core.settings().menuBarIcon).toBe("colour");
    expect(effects).toEqual([
      { type: "applyMenuBarIcon", icon: "monochrome" },
      { type: "applyMenuBarIcon", icon: "colour" },
    ]);
  });

  it("choosing an icon keeps it, setting it in the config file with the file's comments and other settings kept", () => {
    const { core, effects } = startCore(undefined, '{\n  // Mine.\n  "cycleOrder": "created"\n}\n');
    effects.length = 0;

    core.previewMenuBarIcon("colour");
    core.choosePaletteResult(core.menuBarIconResults("col")[0]);
    const written = '{\n  // Mine.\n  "cycleOrder": "created",\n  "menuBarIcon": "colour"\n}\n';
    core.configChanged(written);
    core.paletteDismissed();

    expect(core.menuBarIcon()).toBe("colour");
    expect(core.settings().menuBarIcon).toBe("colour");
    expect(effects).toEqual([
      { type: "applyMenuBarIcon", icon: "colour" },
      { type: "writeConfig", text: written },
    ]);
  });

  it("choosing an icon while the config file can't be read applies it without writing the file, telling the user", () => {
    const { core, effects } = startCore();
    core.configUnreadable();
    effects.length = 0;

    core.choosePaletteResult(core.menuBarIconResults("col")[0]);

    expect(core.menuBarIcon()).toBe("colour");
    expect(effects).toEqual([{ type: "applyMenuBarIcon", icon: "colour" }, { type: "configUnreadable" }]);
  });
});

// Runs the app action the Command Palette offers under `label`.
function chooseAction(core: ReturnType<typeof startCore>["core"], label: string) {
  const action = core.paletteResults("").find((result) => result.type === "action" && result.label === label);
  if (!action) throw new Error(`No app action is labelled ${label}`);
  core.choosePaletteResult(action);
}

// Chooses the Theme by its name, as the Command Palette does once it lists the Themes.
function chooseTheme(core: ReturnType<typeof startCore>["core"], name: string) {
  core.choosePaletteResult({ type: "theme", name, label: name });
}

// Each result as its type and label, e.g. `tab vim`.
function summarize(results: PaletteResult[]) {
  return results.map((result) => `${result.type} ${result.label}`);
}
