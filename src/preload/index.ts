import { contextBridge, ipcRenderer } from "electron";
import { type BlindApi, channels } from "../shared/ipc";

const api: BlindApi = {
  onSessionView: (listener) => {
    ipcRenderer.on(channels.sessionView, (_event, view) => listener(view));
  },
  focusPane: (paneId) => ipcRenderer.send(channels.focusPane, paneId),
  attachPane: (paneId, size) => ipcRenderer.invoke(channels.attachPane, paneId, size),
  writeToPane: (paneId, data) => ipcRenderer.send(channels.writeToPane, paneId, data),
  resizePane: (paneId, size) => ipcRenderer.send(channels.resizePane, paneId, size),
  onPaneData: (listener) => {
    ipcRenderer.on(channels.paneData, (_event, paneId, data) => listener(paneId, data));
  },
  reportScrollback: (paneId, scrollback) => ipcRenderer.send(channels.reportScrollback, paneId, scrollback),
  // Messages from one page arrive in order, so the main process has every report once it hears back.
  onFlushScrollback: (listener) => {
    ipcRenderer.on(channels.flushScrollback, () => {
      listener();
      ipcRenderer.send(channels.scrollbackFlushed);
    });
  },
};

contextBridge.exposeInMainWorld("blind", api);
