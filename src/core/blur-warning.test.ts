import { describe, expect, it } from 'vitest'
import { blurIssueUrl, shouldWarnBlurUnavailable } from './blur-warning'

describe('the blur-unavailable pop-up', () => {
  const versions = { app: '1.4.0', os: '27.2' }

  it('shows the first time blur is wanted in a launch, with nothing dismissed', () => {
    expect(
      shouldWarnBlurUnavailable({ backgroundEffect: 'blur', warnedThisLaunch: false, dismissedFor: undefined, versions })
    ).toBe(true)
  })

  it("doesn't show while the background effect is none", () => {
    expect(
      shouldWarnBlurUnavailable({ backgroundEffect: 'none', warnedThisLaunch: false, dismissedFor: undefined, versions })
    ).toBe(false)
  })

  it("doesn't show a second time in the same launch", () => {
    expect(
      shouldWarnBlurUnavailable({ backgroundEffect: 'blur', warnedThisLaunch: true, dismissedFor: undefined, versions })
    ).toBe(false)
  })

  it("stays away after Don't show again until Blind or macOS changes version", () => {
    const check = (dismissedFor: { app: string; os: string }) =>
      shouldWarnBlurUnavailable({ backgroundEffect: 'blur', warnedThisLaunch: false, dismissedFor, versions })

    expect(check({ app: '1.4.0', os: '27.2' })).toBe(false)
    expect(check({ app: '1.3.9', os: '27.2' })).toBe(true)
    expect(check({ app: '1.4.0', os: '27.1' })).toBe(true)
  })
})

describe("the blur-unavailable pop-up's Report on GitHub", () => {
  const versions = { app: '1.4.0', os: '27.2' }

  it("opens a new issue on blind's repository, naming the versions and that macOS lacks the function", () => {
    const url = new URL(blurIssueUrl(versions, { type: 'functionMissing' }, '/Users/me'))

    expect(`${url.origin}${url.pathname}`).toBe('https://github.com/diogoleitao/blind/issues/new')
    expect(url.searchParams.get('title')).toBe('Blur no longer works on macOS 27.2')
    expect(url.searchParams.get('body')).toBe(
      "Blind couldn't blur its windows: macOS has no CGSSetWindowBackgroundBlurRadius.\n\n- Blind: 1.4.0\n- macOS: 27.2\n"
    )
  })

  it("names the addon's error when the addon failed to load", () => {
    const url = new URL(blurIssueUrl(versions, { type: 'addonFailed', message: 'image not found' }, '/Users/me'))

    expect(url.searchParams.get('body')).toBe(
      "Blind couldn't blur its windows: its native addon failed to load: image not found.\n\n- Blind: 1.4.0\n- macOS: 27.2\n"
    )
  })

  // The issue is public, so it shows neither the user's name nor how their folders are laid out.
  it("keeps only the error's first line, with the home folder as ~", () => {
    const message =
      "Cannot find module '/Users/me/blind/native/window_effects.node'\nRequire stack:\n- /Users/me/blind/out/main/index.js"

    const url = new URL(blurIssueUrl(versions, { type: 'addonFailed', message }, '/Users/me'))

    expect(url.searchParams.get('body')).toBe(
      "Blind couldn't blur its windows: its native addon failed to load: Cannot find module '~/blind/native/window_effects.node'.\n\n- Blind: 1.4.0\n- macOS: 27.2\n"
    )
  })
})
