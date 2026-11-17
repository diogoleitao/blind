import type { Colour } from './themes'

// A colour's red, green and blue from 0 to 255, and its alpha from 0 to 1.
function rgba (colour: Colour) {
  const value = (start: number) => Number.parseInt(colour.slice(start, start + 2), 16)
  return { red: value(1), green: value(3), blue: value(5), alpha: colour.length === 9 ? value(7) / 255 : 1 }
}

function hex (value: number) {
  return Math.round(value).toString(16).padStart(2, '0')
}

// The colour as `#rrggbb`, without its alpha.
export function opaque (colour: Colour): Colour {
  return colour.slice(0, 7)
}

// A colour from its red, green and blue from 0 to 255, as `#rrggbb`.
export function rgbColour (red: number, green: number, blue: number): Colour {
  return `#${hex(red)}${hex(green)}${hex(blue)}`
}

// A colour space other than sRGB: its tone curve, from a component from 0 to 1 to linear light, and the matrix from its
// linear red, green and blue to sRGB's.
export interface ColourSpace {
  toLinear(component: number): number;
  toLinearSrgb: readonly (readonly [number, number, number])[];
}

// Apple's Generic RGB, which iTerm2 calls Calibrated. Its tone curve's gamma of 461/256 and its matrix come from macOS's
// `Generic RGB Profile.icc`: the matrix takes its primaries to the D50 profile connection space, then out through
// `sRGB Profile.icc`'s, as ColorSync converts.
export const genericRgb: ColourSpace = {
  toLinear: (component) => component ** (461 / 256),
  toLinearSrgb: [
    [1.0252521, -0.0265618, 0.0013006],
    [0.0194079, 0.9480429, 0.0325933],
    [-0.0017629, -0.0014365, 1.0032149],
  ],
}

// Display P3, as SMPTE EG 432-1 defines it: P3's primaries, with sRGB's D65 white and tone curve. macOS's
// `Display P3.icc` agrees with its matrix to within the profile's rounding.
export const displayP3: ColourSpace = {
  toLinear: (component) => component <= 0.04045 ? component / 12.92 : ((component + 0.055) / 1.055) ** 2.4,
  toLinearSrgb: [
    [1.2249401, -0.2249404, 0],
    [-0.0420569, 1.0420571, 0],
    [-0.0196376, -0.0786361, 1.0982735],
  ],
}

// The value clamped to 0 to 1.
function clamped (value: number) {
  return Math.min(1, Math.max(0, value))
}

// A component of linear sRGB, clamped to 0 to 1, with sRGB's tone curve.
function srgbComponent (linear: number) {
  const component = clamped(linear)
  return component <= 0.0031308 ? component * 12.92 : 1.055 * component ** (1 / 2.4) - 0.055
}

// A colour from its red, green and blue in `colourSpace`, each clamped to 0 to 1, as `#rrggbb` in sRGB.
export function convertedColour (components: readonly number[], colourSpace: ColourSpace): Colour {
  const linear = components.map((component) => colourSpace.toLinear(clamped(component)))
  const [red, green, blue] = colourSpace.toLinearSrgb.map((row) =>
    srgbComponent(row.reduce((sum, weight, index) => sum + weight * linear[index], 0)) * 255
  )
  return rgbColour(red, green, blue)
}

// The colour with its alpha scaled by `factor`.
export function withOpacity (colour: Colour, factor: number): Colour {
  return `${opaque(colour)}${hex(rgba(colour).alpha * 255 * factor)}`
}

// `colour` mixed into `into`, making up `weight` of the result, from 0 to 1, with each colour weighed by its alpha as
// CSS color-mix does in sRGB; always with an alpha, e.g. `#676b81ff`.
export function mixColours (colour: Colour, into: Colour, weight: number): Colour {
  const mixed = rgba(colour)
  const base = rgba(into)
  const alpha = mixed.alpha * weight + base.alpha * (1 - weight)
  const mix = (name: 'red' | 'green' | 'blue') =>
    alpha === 0 ? 0 : (mixed[name] * mixed.alpha * weight + base[name] * base.alpha * (1 - weight)) / alpha
  return `#${hex(mix('red'))}${hex(mix('green'))}${hex(mix('blue'))}${hex(alpha * 255)}`
}
