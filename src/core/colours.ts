import type { Colour } from './themes'

// A colour's red, green and blue from 0 to 255, and its alpha from 0 to 1.
function rgba (colour: Colour) {
  const value = (start: number) => Number.parseInt(colour.slice(start, start + 2), 16)
  return { red: value(1), green: value(3), blue: value(5), alpha: colour.length === 9 ? value(7) / 255 : 1 }
}

function hex (value: number) {
  return Math.round(value).toString(16).padStart(2, '0')
}

// The colour with its alpha scaled by `factor`.
export function withOpacity (colour: Colour, factor: number): Colour {
  return `${colour.slice(0, 7)}${hex(rgba(colour).alpha * 255 * factor)}`
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
