/** Accessible foreground for a validated six-digit accent color. */
export function accentForeground(color: string): '#000000' | '#ffffff' {
  const rgb = color.match(/^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i)
  if (!rgb) return '#ffffff'
  const linear = rgb.slice(1).map((part) => {
    const value = parseInt(part, 16) / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  const luminance = linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722
  return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) ? '#000000' : '#ffffff'
}
