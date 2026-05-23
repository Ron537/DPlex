const CSI_7BIT = '\x1b['
const CSI_8BIT = '\x9b'

// Hard cap on the pending buffer to bound memory if a PTY ever emits a CSI
// introducer followed by an unending stream of param bytes. Real SGR params
// are tens of bytes; xterm.js's own parser has a similar guard.
const MAX_PENDING = 4096

// Matches the ESC byte literally — recognising CSI/SGR sequences is the
// whole purpose of this module.
// eslint-disable-next-line no-control-regex
const SGR_CSI_PATTERN = /(\x1b\[|\x9b)([0-9:;]*m)/g
const COLON_TRUECOLOR_PATTERN = /(^|;)(38|48|58):2:(\d{1,3}):(\d{1,3}):(\d{1,3})(?=;|$)/g

function normalizeSgrParams(params: string): string {
  return params.replace(COLON_TRUECOLOR_PATTERN, (_match, prefix, target, r, g, b) => {
    return `${prefix}${target};2;${r};${g};${b}`
  })
}

function findIncompleteCsiStart(data: string): number {
  // Return the earliest position that must be held back to the next chunk.
  // Two independent heuristics, both expressed as a candidate split point:
  //   (a) an unterminated CSI introducer (`\x1b[` / `\x9b`) followed by params
  //       without a final byte (0x40–0x7e);
  //   (b) a lone trailing ESC, which may grow into a CSI on the next chunk.
  // We retain from the earlier of the two so that a chunk containing both a
  // mid-sequence introducer AND a trailing ESC isn't emitted half-raw.
  let tail = data.length

  const escStart = data.lastIndexOf(CSI_7BIT)
  const c1Start = data.lastIndexOf(CSI_8BIT)
  const start = Math.max(escStart, c1Start)
  if (start !== -1) {
    const paramsStart = start === escStart ? start + CSI_7BIT.length : start + CSI_8BIT.length
    let terminated = false
    for (let i = paramsStart; i < data.length; i++) {
      const code = data.charCodeAt(i)
      if (code >= 0x40 && code <= 0x7e) {
        terminated = true
        break
      }
    }
    if (!terminated) tail = Math.min(tail, start)
  }

  if (data.endsWith('\x1b')) tail = Math.min(tail, data.length - 1)

  return tail
}

export function normalizeColonTruecolorSgr(data: string): string {
  return data.replace(SGR_CSI_PATTERN, (_match, csi, paramsWithFinal) => {
    const params = paramsWithFinal.slice(0, -1)
    return `${csi}${normalizeSgrParams(params)}m`
  })
}

export class TruecolorSgrNormalizer {
  private pending = ''

  write(data: string): string {
    const input = this.pending + data
    this.pending = ''

    const tailStart = findIncompleteCsiStart(input)
    if (tailStart === input.length) {
      return normalizeColonTruecolorSgr(input)
    }

    const tail = input.slice(tailStart)
    if (tail.length > MAX_PENDING) {
      // Pathological: emit everything we have (best-effort normalized) and
      // reset, rather than let `pending` grow without bound.
      return normalizeColonTruecolorSgr(input)
    }
    this.pending = tail
    return normalizeColonTruecolorSgr(input.slice(0, tailStart))
  }
}
