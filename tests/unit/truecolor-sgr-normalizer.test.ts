import { describe, expect, it } from 'vitest'
import {
  normalizeColonTruecolorSgr,
  TruecolorSgrNormalizer
} from '../../src/renderer/src/services/truecolorSgrNormalizer'

describe('normalizeColonTruecolorSgr', () => {
  it('rewrites colon truecolor SGR without a colorspace slot to semicolon form', () => {
    expect(normalizeColonTruecolorSgr('\x1b[48:2:30:30:46m ')).toBe('\x1b[48;2;30;30;46m ')
    expect(normalizeColonTruecolorSgr('\x1b[38:2:122:162:247mblue')).toBe(
      '\x1b[38;2;122;162;247mblue'
    )
  })

  it('rewrites foreground, background, and underline colors inside mixed SGR params', () => {
    expect(
      normalizeColonTruecolorSgr('\x1b[0;38:2:122:162:247;48:2:30:30:46;58:2:255:158:100m')
    ).toBe('\x1b[0;38;2;122;162;247;48;2;30;30;46;58;2;255;158;100m')
  })

  it('leaves already-valid SGR and non-SGR CSI sequences untouched', () => {
    expect(normalizeColonTruecolorSgr('\x1b[48:2::30:30:46m')).toBe('\x1b[48:2::30:30:46m')
    expect(normalizeColonTruecolorSgr('\x1b[48;2;30;30;46m')).toBe('\x1b[48;2;30;30;46m')
    expect(normalizeColonTruecolorSgr('\x1b[38:5:12m')).toBe('\x1b[38:5:12m')
    expect(normalizeColonTruecolorSgr('\x1b[2J')).toBe('\x1b[2J')
  })
})

describe('TruecolorSgrNormalizer', () => {
  it('handles truecolor SGR sequences split across PTY chunks', () => {
    const normalizer = new TruecolorSgrNormalizer()

    expect(normalizer.write('a\x1b[48:2:30')).toBe('a')
    expect(normalizer.write(':30:46m b')).toBe('\x1b[48;2;30;30;46m b')
  })
})
