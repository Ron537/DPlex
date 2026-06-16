/**
 * Lane colors for the commit graph. Chosen to stay legible on both light and
 * dark themes (medium saturation/lightness hues). Indexed by the integer
 * `color` values produced by `computeGraphLayout`; the array length matches
 * `LANE_COLOR_COUNT`.
 */
export const LANE_COLORS = [
  '#4f9cf9', // blue
  '#3fb950', // green
  '#db61a2', // pink
  '#d29922', // amber
  '#a371f7', // purple
  '#2dd4bf', // teal
  '#f0883e', // orange
  '#e5534b' // red
] as const

export function laneColor(index: number): string {
  return LANE_COLORS[((index % LANE_COLORS.length) + LANE_COLORS.length) % LANE_COLORS.length]
}
