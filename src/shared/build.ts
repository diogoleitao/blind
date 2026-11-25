import type { Build } from '../core/ports'

// Written in as the main process and Blind Spot are built, by electron.vite.config.ts.
declare const __BLIND_BUILD__: Build

// The Build of this running copy of Blind.
export const build: Build = __BLIND_BUILD__
