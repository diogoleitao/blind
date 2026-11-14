import type { BackgroundEffect } from './config'

// The versions of Blind and of macOS the app is running on, e.g. `1.4.0` and `27.2`.
export interface Versions {
  app: string;
  os: string;
}

export interface BlurWarningCheck {
  backgroundEffect: BackgroundEffect;
  // Whether the pop-up has already shown since the app started.
  warnedThisLaunch: boolean;
  // The versions "Don't show again" was chosen on, if it ever was.
  dismissedFor: Versions | undefined;
  versions: Versions;
}

// Whether the pop-up saying blur doesn't work shows: once per launch, only while blur is wanted, and not while
// "Don't show again" holds, which it does until Blind or macOS changes version.
export function shouldWarnBlurUnavailable ({ backgroundEffect, warnedThisLaunch, dismissedFor, versions }: BlurWarningCheck) {
  const dismissed = dismissedFor?.app === versions.app && dismissedFor.os === versions.os
  return backgroundEffect === 'blur' && !warnedThisLaunch && !dismissed
}

// Why blur doesn't work: macOS no longer has the private function, or the addon calling it couldn't load.
export type BlurFailure = { type: 'functionMissing' } | { type: 'addonFailed'; message: string }

// The addon's error is cut to its first line, leaving out Node's require stack, with `homeDirectory` written as `~`.
function describeFailure (failure: BlurFailure, homeDirectory: string) {
  if (failure.type === 'functionMissing') return 'macOS has no CGSSetWindowBackgroundBlurRadius'
  const firstLine = failure.message.split('\n')[0].replaceAll(homeDirectory, '~')
  return `its native addon failed to load: ${firstLine}`
}

// A new issue on Blind's repository, filled in with what went wrong and on which versions. The issue is public, so
// it shows nothing of the user's home folder.
export function blurIssueUrl (versions: Versions, failure: BlurFailure, homeDirectory: string) {
  const title = `Blur no longer works on macOS ${versions.os}`
  const body = `Blind couldn't blur its windows: ${describeFailure(failure, homeDirectory)}.\n\n- Blind: ${versions.app}\n- macOS: ${versions.os}\n`
  return `https://github.com/diogoleitao/blind/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`
}
