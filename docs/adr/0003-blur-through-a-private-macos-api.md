# Blur through a private macOS API, not Electron's vibrancy

Windows blur what's behind them through blind's own native addon, which calls the private `CGSSetWindowBackgroundBlurRadius`, as iTerm2, Ghostty and Alacritty do. Electron's vibrancy can't set a blur radius: its materials fix the strength and add a tint, and the result was too intense next to iTerm2's plain blur at radius 15. A private API can break in any macOS update, so the addon looks the function up at runtime and, when it's missing, blind shows no blur and tells the user rather than failing.

## Considered Options

- Electron's vibrancy materials: public, but they differ mostly in tint, not strength.
- Changing the filters of `NSVisualEffectView`'s backdrop layer: just as private, and more fragile.
- Capturing the screen behind the window and blurring it in the page: public, but needs the Screen Recording permission, costs a frame's work on every change behind the window, and lags.
- An npm package wrapping the function: none exists.

## Consequences

- A radius of 0 is reported to turn blur off for the window for good, so the radius is never below 1.
- An App Store build could be rejected for the private API.
