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
};

contextBridge.exposeInMainWorld("blind", api);
