import { createRequire } from 'node:module'
import type { BrowserWindow } from 'electron'
import type { BlurFailure } from '../core/blur-warning'

interface WindowEffectsAddon {
  blurAvailable(): boolean;
  setBlurRadius(handle: Buffer, radius: number): boolean;
}

// What the native addon in `native/` does to a window, or why blur can't be done.
export type WindowEffects =
  | { available: true; setBlurRadius(window: BrowserWindow, radius: number): void }
  | { available: false; failure: BlurFailure }

// Loads the addon at `path`. A failure to load, or a macOS without the private function, leaves blur unavailable
// rather than stopping the app.
export function loadWindowEffects (path: string): WindowEffects {
  let addon: WindowEffectsAddon
  try {
    addon = createRequire(import.meta.url)(path)
  } catch (error) {
    console.warn(`Couldn't load the native addon ${path}; windows won't blur:`, error)
    return { available: false, failure: { type: 'addonFailed', message: (error as Error).message } }
  }
  if (!addon.blurAvailable()) {
    console.warn("macOS has no CGSSetWindowBackgroundBlurRadius; windows won't blur.")
    return { available: false, failure: { type: 'functionMissing' } }
  }
  return {
    available: true,
    setBlurRadius (window, radius) {
      if (!addon.setBlurRadius(window.getNativeWindowHandle(), radius)) {
        console.warn(`macOS didn't take the blur radius ${radius} for a window.`)
      }
    },
  }
}
