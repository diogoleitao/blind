import type { BrowserWindow } from 'electron'

const durationMilliseconds = 150
const stepMilliseconds = 10
const fadeTimers = new WeakMap<BrowserWindow, ReturnType<typeof setInterval>>()

// Animates the window's opacity towards `target`, replacing any fade already running on it.
export function fadeWindow (window: BrowserWindow, target: number, onDone?: () => void) {
  clearInterval(fadeTimers.get(window))
  const from = window.getOpacity()
  const startedAt = Date.now()
  const timer = setInterval(() => {
    if (window.isDestroyed()) return clearInterval(timer)
    const progress = Math.min(1, (Date.now() - startedAt) / durationMilliseconds)
    window.setOpacity(from + (target - from) * progress)
    if (progress < 1) return
    clearInterval(timer)
    fadeTimers.delete(window)
    onDone?.()
  }, stepMilliseconds)
  fadeTimers.set(window, timer)
}
