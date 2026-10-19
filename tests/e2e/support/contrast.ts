import { expect, type Locator } from '@playwright/test'

/** Measure the rendered foreground against an opaque, solid control fill. */
export async function expectSolidContrast(control: Locator, minimum = 4.5): Promise<void> {
  await expect(control).toBeVisible()
  await expect(control).toHaveCSS('background-image', 'none')
  const contrast = await control.evaluate((el) => {
    const luminance = (color: string): number => {
      const rgb = color
        .match(/[\d.]+/g)!
        .slice(0, 3)
        .map(Number)
      const linear = rgb.map((channel) => {
        const value = channel / 255
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
      })
      return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722
    }
    const style = getComputedStyle(el)
    const fg = luminance(style.color)
    const bg = luminance(style.backgroundColor)
    return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05)
  })
  expect(contrast).toBeGreaterThanOrEqual(minimum)
}
