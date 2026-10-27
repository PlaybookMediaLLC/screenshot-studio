import assert from 'node:assert/strict'
import test from 'node:test'
import { accentForeground } from '@/lib/settings/accent'

test('personal accents keep button labels at WCAG AA contrast across the color space', () => {
  for (let r = 0; r < 256; r += 17)
    for (let g = 0; g < 256; g += 17)
      for (let b = 0; b < 256; b += 17) {
        const color = `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`
        const rgb = [r, g, b]
          .map((v) => v / 255)
          .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
        const l = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722
        const ratio = accentForeground(color) === '#ffffff' ? 1.05 / (l + 0.05) : (l + 0.05) / 0.05
        assert.ok(ratio >= 4.5, `${color}: ${ratio}`)
      }
})
