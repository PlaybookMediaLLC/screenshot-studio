/** A visible line of text, measured in the rendered stage's coordinates. */
export type TextLineBounds = { left: number; top: number; right: number; bottom: number }

/** Find the first pair of text layers whose painted lines overlap, ignoring subpixel rounding. */
export function overlappingTextLayers(
  layers: readonly { label: string; lines: readonly TextLineBounds[] }[]
): [string, string] | null {
  for (let index = 0; index < layers.length; index++) {
    const first = layers[index]!
    for (const second of layers.slice(index + 1)) {
      if (
        first.lines.some((a) =>
          second.lines.some(
            (b) =>
              Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
              Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1
          )
        )
      )
        return [first.label, second.label]
    }
  }
  return null
}
