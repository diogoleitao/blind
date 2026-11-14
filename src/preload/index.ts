import { contextBridge, ipcRenderer } from 'electron'
import { type BlindApi, channels } from '../shared/ipc'

const api: BlindApi = {
  onSessionView: (listener) => {
    ipcRenderer.on(channels.sessionView, (_event, view) => listener(view))
  },
  onWindowSettings: (listener) => {
    ipcRenderer.on(channels.windowSettings, (_event, settings) => listener(settings))
  },
  onShowSessionBanner: (listener) => {
    ipcRenderer.on(channels.showSessionBanner, (_event, label) => listener(label))
  },
  focusPane: (paneId) => ipcRenderer.send(channels.focusPane, paneId),
  attachPane: (paneId, size) => ipcRenderer.invoke(channels.attachPane, paneId, size),
  writeToPane: (paneId, data) => ipcRenderer.send(channels.writeToPane, paneId, data),
  resizePane: (paneId, size) => ipcRenderer.send(channels.resizePane, paneId, size),
  onPaneData: (listener) => {
    ipcRenderer.on(channels.paneData, (_event, paneId, data) => listener(paneId, data))
  },
  reportScrollback: (paneId, scrollback) => ipcRenderer.send(channels.reportScrollback, paneId, scrollback),
  reportNotification: (paneId) => ipcRenderer.send(channels.reportNotification, paneId),
  reportProgramStatus: (paneId, report) => ipcRenderer.send(channels.reportProgramStatus, paneId, report),
  // Messages from one page arrive in order, so the main process has every report once it hears back.
  onFlushScrollback: (listener) => {
    ipcRenderer.on(channels.flushScrollback, () => {
      listener()
      ipcRenderer.send(channels.scrollbackFlushed)
    })
  },
  onOpenPalette: (listener) => {
    ipcRenderer.on(channels.openPalette, () => listener())
  },
  dismissPalette: () => ipcRenderer.send(channels.dismissPalette),
  searchPalette: (query) => ipcRenderer.invoke(channels.searchPalette, query),
  choosePaletteResult: (result) => ipcRenderer.send(channels.choosePaletteResult, result),
  onPalettePrompt: (listener) => {
    ipcRenderer.on(channels.promptPalette, (_event, prompt) => listener(prompt))
  },
  answerPalettePrompt: (prompt, answer) => ipcRenderer.send(channels.answerPalettePrompt, prompt, answer),
  onTheme: (listener) => {
    ipcRenderer.on(channels.applyTheme, (_event, theme) => listener(theme))
  },
  onPickTheme: (listener) => {
    ipcRenderer.on(channels.pickTheme, () => listener())
  },
  searchThemes: (query) => ipcRenderer.invoke(channels.searchThemes, query),
  previewTheme: (name) => ipcRenderer.send(channels.previewTheme, name),
  onPickMenuBarIcon: (listener) => {
    ipcRenderer.on(channels.pickMenuBarIcon, (_event, icon) => listener(icon))
  },
  searchMenuBarIcons: (query) => ipcRenderer.invoke(channels.searchMenuBarIcons, query),
  previewMenuBarIcon: (icon) => ipcRenderer.send(channels.previewMenuBarIcon, icon),
  onFindInPane: (listener) => {
    ipcRenderer.on(channels.findInPane, (_event, paneId) => listener(paneId))
  },
  onClearScrollback: (listener) => {
    ipcRenderer.on(channels.clearScrollback, (_event, paneId) => listener(paneId))
  },
  onCopy: (listener) => {
    ipcRenderer.on(channels.copy, () => listener())
  },
  copyText: (text) => ipcRenderer.send(channels.copyText, text),
  onPaste: (listener) => {
    ipcRenderer.on(channels.paste, (_event, text) => listener(text))
  },
  openableLinks: (paneId, texts) => ipcRenderer.invoke(channels.openableLinks, paneId, texts),
  openLink: (paneId, text) => ipcRenderer.send(channels.openLink, paneId, text),
}

contextBridge.exposeInMainWorld('blind', api)
