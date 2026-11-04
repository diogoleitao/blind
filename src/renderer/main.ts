import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import type { BlindApi } from "../shared/ipc";

declare global {
  interface Window {
    blind: BlindApi;
  }
}

const { blind } = window;
const paneId = await blind.sessionPane();

if (paneId) {
  // The page's background shows through, keeping the window's transparency and blur.
  const terminal = new Terminal({ allowTransparency: true, theme: { background: "#00000000" } });
  const fit = new FitAddon();
  terminal.loadAddon(fit);
  terminal.open(document.getElementById("pane")!);
  fit.fit();

  blind.onPaneData((id, data) => {
    if (id === paneId) terminal.write(data);
  });
  terminal.onData((data) => blind.writeToPane(paneId, data));
  terminal.onResize((size) => blind.resizePane(paneId, size));
  window.addEventListener("resize", () => fit.fit());

  await blind.attachPane(paneId, { cols: terminal.cols, rows: terminal.rows });
  terminal.focus();
}
