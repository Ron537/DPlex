const CSI_7BIT = '\x1b['
const CSI_8BIT = '\x9b'

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
  const escStart = data.lastIndexOf(CSI_7BIT)
  const c1Start = data.lastIndexOf(CSI_8BIT)
  const start = Math.max(escStart, c1Start)
  if (start === -1) return data.length

  const paramsStart = start === escStart ? start + CSI_7BIT.length : start + CSI_8BIT.length
  for (let i = paramsStart; i < data.length; i++) {
    const code = data.charCodeAt(i)
    if (code >= 0x40 && code <= 0x7e) return data.length
  }

  return start
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

    this.pending = input.slice(tailStart)
    return normalizeColonTruecolorSgr(input.slice(0, tailStart))
  }
}
