import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import type { PaneId } from "../core/state";
import type { BlindApi, SessionView } from "../shared/ipc";

declare global {
  interface Window {
    blind: BlindApi;
  }
}

interface PaneTerminal {
  element: HTMLDivElement;
  terminal: Terminal;
  fit: FitAddon;
}

const { blind } = window;
const panesElement = document.getElementById("panes")!;
const tabBar = document.getElementById("tab-bar")!;
const terminals = new Map<PaneId, PaneTerminal>();
let focusedPaneId: PaneId | undefined;

function openPane(paneId: PaneId): PaneTerminal {
  const element = document.createElement("div");
  element.className = "pane";
  panesElement.append(element);
  // The page's background shows through, keeping the window's transparency and blur.
  const terminal = new Terminal({ allowTransparency: true, theme: { background: "#00000000" } });
  const fit = new FitAddon();
  terminal.loadAddon(fit);
  terminal.open(element);
  fit.fit();
  terminal.onData((data) => blind.writeToPane(paneId, data));
  terminal.onResize((size) => blind.resizePane(paneId, size));
  void blind.attachPane(paneId, { cols: terminal.cols, rows: terminal.rows });
  return { element, terminal, fit };
}

function renderTabBar(view: SessionView) {
  tabBar.hidden = view.tabs.length < 2;
  tabBar.replaceChildren(
    ...view.tabs.map((tab) => {
      const element = document.createElement("div");
      element.className = "tab";
      element.classList.toggle("focused", tab.id === view.focusedTabId);
      element.textContent = tab.title;
      return element;
    }),
  );
}

// Every Pane's terminal stays open, hidden but laid out, so switching Tabs keeps its scrollback and size.
function render(view: SessionView) {
  renderTabBar(view);
  const paneIds = new Set(view.tabs.map((tab) => tab.paneId));
  for (const [paneId, pane] of terminals) {
    if (paneIds.has(paneId)) continue;
    pane.terminal.dispose();
    pane.element.remove();
    terminals.delete(paneId);
  }
  const focusedTab = view.tabs.find((tab) => tab.id === view.focusedTabId);
  for (const tab of view.tabs) {
    const pane = terminals.get(tab.paneId) ?? openPane(tab.paneId);
    terminals.set(tab.paneId, pane);
    pane.element.classList.toggle("hidden", tab !== focusedTab);
  }
  // The Tab bar appearing or disappearing changes the space the Panes have.
  for (const pane of terminals.values()) pane.fit.fit();
  if (focusedTab && focusedTab.paneId !== focusedPaneId) {
    focusedPaneId = focusedTab.paneId;
    terminals.get(focusedPaneId)?.terminal.focus();
  }
}

blind.onPaneData((paneId, data) => terminals.get(paneId)?.terminal.write(data));
blind.onSessionView(render);
window.addEventListener("resize", () => {
  for (const pane of terminals.values()) pane.fit.fit();
});
