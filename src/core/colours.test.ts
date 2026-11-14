import { describe, expect, it } from 'vitest'
import { mixColours } from './colours'

describe('mixing two colours, as CSS color-mix does in sRGB', () => {
  it('weighs each colour by its alpha', () => {
    expect(mixColours('#bbbbbb', '#ffffff33', 0.25)).toBe('#d5d5d566')
  })

  it('mixes opaque colours channel by channel', () => {
    expect(mixColours('#cdd6f4', '#45475a', 0.25)).toBe('#676b81ff')
  })
})
