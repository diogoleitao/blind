import { FitAddon } from "@xterm/addon-fit";
import { SerializeAddon } from "@xterm/addon-serialize";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { defaultSettings } from "../core/config";
import type { PaletteResult } from "../core/core";
import type { PaneRect } from "../core/layout";
import type { PaneId } from "../core/state";
import type { BlindApi, PalettePrompt, SessionView, TerminalSettings } from "../shared/ipc";

declare global {
  interface Window {
    blind: BlindApi;
  }
}

// How long after output starts a Pane's scrollback is reported, so a burst of output is reported once.
const reportDelayMilliseconds = 1_000;

interface PaneTerminal {
  element: HTMLDivElement;
  terminal: Terminal;
  fit: FitAddon;
  serialize: SerializeAddon;
  // Pending while output waits to be reported.
  reportTimer?: ReturnType<typeof setTimeout>;
}

const { blind } = window;
// The page of the Command Palette on its own, which the app shows with no Open Sessions, rather than a Session's.
const standalone = location.hash === "#palette";
const panesElement = document.getElementById("panes")!;
const tabBar = document.getElementById("tab-bar")!;
const terminals = new Map<PaneId, PaneTerminal>();
let focusedPaneId: PaneId | undefined;
// Replaced by the main process's before any terminal opens.
let terminalSettings: TerminalSettings = { scrollbackLines: defaultSettings.scrollbackLines };

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
  const terminal = new Terminal({
    allowTransparency: true,
    theme: { background: "#00000000" },
    scrollback: terminalSettings.scrollbackLines,
  });
  const fit = new FitAddon();
  const serialize = new SerializeAddon();
  terminal.loadAddon(fit);
  terminal.loadAddon(serialize);
  terminal.open(terminalElement);
  fit.fit();
  terminal.onData((data) => blind.writeToPane(paneId, data));
  terminal.onResize((size) => blind.resizePane(paneId, size));
  element.addEventListener("mousedown", () => blind.focusPane(paneId));
  void blind.attachPane(paneId, { cols: terminal.cols, rows: terminal.rows });
  return { element, terminal, fit, serialize };
}

// A full-screen program's screen and the modes it set belong to a process that won't be there after Restore.
function reportScrollback(paneId: PaneId, pane: PaneTerminal) {
  clearTimeout(pane.reportTimer);
  pane.reportTimer = undefined;
  const scrollback = pane.serialize.serialize({
    scrollback: terminalSettings.scrollbackLines,
    excludeAltBuffer: true,
    excludeModes: true,
  });
  blind.reportScrollback(paneId, scrollback);
}

// Open terminals keep their scrollback up to the new number of lines from now on.
function applyTerminalSettings(settings: TerminalSettings) {
  terminalSettings = settings;
  for (const pane of terminals.values()) pane.terminal.options.scrollback = settings.scrollbackLines;
}

function writeToTerminal(paneId: PaneId, data: string) {
  const pane = terminals.get(paneId);
  if (!pane) return;
  pane.terminal.write(data);
  pane.reportTimer ??= setTimeout(() => reportScrollback(paneId, pane), reportDelayMilliseconds);
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
    clearTimeout(pane.reportTimer);
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

const palette = document.getElementById("palette")!;
const paletteInput = document.getElementById("palette-input") as HTMLInputElement;
const paletteList = document.getElementById("palette-results")!;
let paletteResults: PaletteResult[] = [];
let selectedResult = 0;
// Counts searches, so that results arriving after a newer search's are dropped.
let searchCount = 0;
// Settles once the latest search's results are shown, so Enter never chooses from a list typing has outdated.
let latestSearch = Promise.resolve();
// Set while the palette asks for a name or title instead of searching.
let prompt: PalettePrompt | undefined;

const promptPlaceholders: Record<PalettePrompt["type"], string> = {
  askSessionName: "Session name",
  askTabTitle: "Tab title, or empty to follow the running program",
};

const resultKinds: Record<PaletteResult["type"], string> = {
  session: "Session",
  tab: "Tab",
  pane: "Pane",
  action: "Action",
};

// What places a result: a Closed Session's mark, a Tab's Session, or a Pane's working directory and Session.
function resultDetail(result: PaletteResult) {
  if (result.type === "session") return result.closed ? "Closed" : "";
  if (result.type === "tab") return result.sessionLabel;
  if (result.type === "pane") return `${result.workingDirectory} · ${result.sessionLabel}`;
  return "";
}

function renderPalette() {
  paletteList.replaceChildren(
    ...paletteResults.map((result, index) => {
      const element = document.createElement("li");
      element.className = "result";
      element.classList.toggle("selected", index === selectedResult);
      const label = document.createElement("span");
      label.textContent = result.label;
      const detail = document.createElement("span");
      detail.className = "detail";
      detail.textContent = resultDetail(result);
      const kind = document.createElement("span");
      kind.className = "kind";
      kind.textContent = resultKinds[result.type];
      element.append(label, detail, kind);
      element.addEventListener("mousedown", () => chooseResult(index));
      return element;
    }),
  );
  paletteList.children[selectedResult]?.scrollIntoView({ block: "nearest" });
}

function searchPalette() {
  searchCount += 1;
  const search = searchCount;
  latestSearch = blind.searchPalette(paletteInput.value).then((results) => {
    if (search !== searchCount) return;
    paletteResults = results;
    selectedResult = 0;
    renderPalette();
  });
}

function openPalette() {
  prompt = undefined;
  palette.hidden = false;
  paletteInput.placeholder = "";
  paletteInput.value = "";
  paletteInput.focus();
  searchPalette();
}

// Offers the suggestion selected, so typing replaces it and Enter accepts it. A search still in flight is dropped.
function openPrompt(asked: PalettePrompt) {
  prompt = asked;
  searchCount += 1;
  paletteResults = [];
  renderPalette();
  palette.hidden = false;
  paletteInput.placeholder = promptPlaceholders[asked.type];
  paletteInput.value = asked.suggestion;
  paletteInput.focus();
  paletteInput.select();
}

// The focused Pane's terminal takes the keyboard back.
function closePalette() {
  if (palette.hidden) return;
  palette.hidden = true;
  prompt = undefined;
  if (focusedPaneId) terminals.get(focusedPaneId)?.terminal.focus();
}

// Closing without a choice, by Escape or by clicking away. Choosing closes the palette first, so a blur that follows
// isn't taken for one.
function dismissPalette() {
  if (palette.hidden) return;
  closePalette();
  blind.dismissPalette();
}

// The typed text answers the prompt that was showing; `closePalette` clears it.
function answerPrompt(shown: PalettePrompt) {
  const answer = paletteInput.value;
  closePalette();
  blind.answerPalettePrompt(shown, answer);
}

// Does nothing once the palette has closed, e.g. by Escape while Enter waited for a search.
function chooseResult(index: number) {
  const result = paletteResults[index];
  if (palette.hidden || !result) return;
  closePalette();
  blind.choosePaletteResult(result);
}

function moveSelection(offset: number) {
  const count = paletteResults.length;
  if (count === 0) return;
  selectedResult = (selectedResult + offset + count) % count;
  renderPalette();
}

paletteInput.addEventListener("input", () => {
  if (!prompt) searchPalette();
});
paletteInput.addEventListener("keydown", (event) => {
  if (event.key === "Escape") dismissPalette();
  else if (event.key === "Enter" && prompt) answerPrompt(prompt);
  else if (prompt) return;
  else if (event.key === "ArrowDown") moveSelection(1);
  else if (event.key === "ArrowUp") moveSelection(-1);
  else if (event.key === "Enter") void latestSearch.then(() => chooseResult(selectedResult));
  else return;
  event.preventDefault();
});
// Clicks inside the palette keep the input focused; clicking a Pane, or the app hiding, closes the palette.
palette.addEventListener("mousedown", (event) => {
  if (event.target !== paletteInput) event.preventDefault();
});
paletteInput.addEventListener("blur", dismissPalette);

blind.onTerminalSettings(applyTerminalSettings);
blind.onOpenPalette(openPalette);
blind.onPalettePrompt(openPrompt);
blind.onPaneData(writeToTerminal);
blind.onFlushScrollback(() => terminals.forEach((pane, paneId) => reportScrollback(paneId, pane)));
blind.onSessionView(render);
window.addEventListener("resize", () => {
  for (const pane of terminals.values()) pane.fit.fit();
});
// Shown the first time once loaded; the main process asks for it on every later showing.
if (standalone) {
  document.body.classList.add("standalone");
  openPalette();
}
