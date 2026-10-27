/** A CSS color with its alpha multiplied by `alpha`; hex and rgb() colors are supported. */
export function withAlpha(color: string, alpha: number): string {
  const hex = color.match(/^#([0-9a-f]{3,8})$/i)?.[1]
  if (hex) {
    const full = hex.length <= 4 ? [...hex].map((digit) => digit + digit).join('') : hex
    const [r, g, b] = [0, 2, 4].map((index) => parseInt(full.slice(index, index + 2), 16))
    const base = full.length === 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1
    return `rgba(${r}, ${g}, ${b}, ${+(base * alpha).toFixed(3)})`
  }
  const rgb = color.match(/^rgba?\(([^)]+)\)$/i)?.[1]
  if (rgb) {
    const [r, g, b, a = '1'] = rgb.split(',').map((part) => part.trim())
    return `rgba(${r}, ${g}, ${b}, ${+(parseFloat(a) * alpha).toFixed(3)})`
  }
  return color
}
