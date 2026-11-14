import { createRequire } from 'node:module'
import type { BrowserWindow } from 'electron'
import type { BlurFailure } from '../core/blur-warning'

interface WindowEffectsAddon {
  blurAvailable(): boolean;
  setBlurRadius(handle: Buffer, radius: number): boolean;
  turnOffShowAnimation(handle: Buffer): boolean;
}

// What the native addon in `native/` does to a window. Each does nothing when it can't be done: blur when the addon
// failed to load or macOS lacks the private function, the show animation only when the addon failed to load.
export interface WindowEffects {
  // Why windows can't blur, if they can't.
  blurFailure: BlurFailure | undefined;
  setBlurRadius(window: BrowserWindow, radius: number): void;
  turnOffShowAnimation(window: BrowserWindow): void;
}

// Loads the addon at `path`. A failure to load leaves windows unblurred and with macOS's show animation, rather than
// stopping the app.
export function loadWindowEffects (path: string): WindowEffects {
  let addon: WindowEffectsAddon
  try {
    addon = createRequire(import.meta.url)(path)
  } catch (error) {
    console.warn(`Couldn't load the native addon ${path}; windows won't blur, and show with macOS's animation:`, error)
    return {
      blurFailure: { type: 'addonFailed', message: (error as Error).message },
      setBlurRadius () {},
      turnOffShowAnimation () {},
    }
  }
  const blurAvailable = addon.blurAvailable()
  if (!blurAvailable) console.warn("macOS has no CGSSetWindowBackgroundBlurRadius; windows won't blur.")
  return {
    blurFailure: blurAvailable ? undefined : { type: 'functionMissing' },
    setBlurRadius (window, radius) {
      if (!blurAvailable) return
      if (!addon.setBlurRadius(window.getNativeWindowHandle(), radius)) {
        console.warn(`macOS didn't take the blur radius ${radius} for a window.`)
      }
    },
    turnOffShowAnimation (window) {
      if (!addon.turnOffShowAnimation(window.getNativeWindowHandle())) {
        console.warn("Couldn't turn off a window's show animation.")
      }
    },
  }
}
