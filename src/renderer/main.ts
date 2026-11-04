import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import type { PaneRect } from "../core/layout";
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

// Puts a Pane's element at its rectangle, with a divider along each edge it shares with another Pane.
function place(element: HTMLDivElement, rect: PaneRect) {
  Object.assign(element.style, {
    left: `${rect.x * 100}%`,
    top: `${rect.y * 100}%`,
    width: `${rect.width * 100}%`,
    height: `${rect.height * 100}%`,
  });
  element.classList.toggle("divided-left", rect.x > 0);
  element.classList.toggle("divided-top", rect.y > 0);
}

// The terminal sits inside the Pane's element, so the fit leaves room for the Pane's dividers. The element is placed
// before the terminal opens, so the Shell starts at the Pane's size.
function openPane(rect: PaneRect): PaneTerminal {
  const { paneId } = rect;
  const element = document.createElement("div");
  element.className = "pane";
  place(element, rect);
  const terminalElement = document.createElement("div");
  terminalElement.className = "terminal";
  element.append(terminalElement);
  panesElement.append(element);
  // The page's background shows through, keeping the window's transparency and blur.
  const terminal = new Terminal({ allowTransparency: true, theme: { background: "#00000000" } });
  const fit = new FitAddon();
  terminal.loadAddon(fit);
  terminal.open(terminalElement);
  fit.fit();
  terminal.onData((data) => blind.writeToPane(paneId, data));
  terminal.onResize((size) => blind.resizePane(paneId, size));
  element.addEventListener("mousedown", () => blind.focusPane(paneId));
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
  const panes = view.tabs.flatMap((tab) => tab.panes.map((rect) => ({ tab, rect })));
  const paneIds = new Set(panes.map(({ rect }) => rect.paneId));
  for (const [paneId, pane] of terminals) {
    if (paneIds.has(paneId)) continue;
    pane.terminal.dispose();
    pane.element.remove();
    terminals.delete(paneId);
  }
  const focusedTab = view.tabs.find((tab) => tab.id === view.focusedTabId);
  for (const { tab, rect } of panes) {
    const pane = terminals.get(rect.paneId) ?? openPane(rect);
    terminals.set(rect.paneId, pane);
    place(pane.element, rect);
    pane.element.classList.toggle("hidden", tab !== focusedTab);
  }
  // Splits, closed Panes, and the Tab bar appearing or disappearing all change the space the Panes have.
  for (const pane of terminals.values()) pane.fit.fit();
  if (focusedTab && focusedTab.focusedPaneId !== focusedPaneId) {
    focusedPaneId = focusedTab.focusedPaneId;
    terminals.get(focusedPaneId)?.terminal.focus();
  }
}

blind.onPaneData((paneId, data) => terminals.get(paneId)?.terminal.write(data));
blind.onSessionView(render);
window.addEventListener("resize", () => {
  for (const pane of terminals.values()) pane.fit.fit();
});
