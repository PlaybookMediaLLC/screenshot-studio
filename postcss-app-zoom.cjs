/* global module */
/**
 * The signed-in app's zoom (`--app-zoom`, set in app/globals.css): every CSS
 * pixel length larger than a hairline becomes `calc(Npx * var(--app-zoom, 1))`,
 * and rem lengths follow the root font size. Where the zoom is unset the
 * factor is 1, so nothing changes. CSS `zoom` would scale the page too, but it
 * shrinks viewport units and misplaces every floating-ui popover.
 *
 * Values with quotes or url() are left alone, so data URIs and strings stay
 * intact, and so are at-rule parameters, so media queries keep their widths.
 */
const PX = /(^|[^\w.-])(-?)(\d*\.?\d+)px\b/g

/** A declaration value with its pixel lengths scaled. */
function zoomed(value) {
  return value.replace(PX, (match, before, sign, number) =>
    Number(number) <= 1 ? match : `${before}calc(${sign}${number}px * var(--app-zoom, 1))`
  )
}

/** @type {import('postcss').PluginCreator<void>} */
module.exports = () => ({
  postcssPlugin: 'app-zoom',
  // After every other plugin, so Tailwind's generated utilities are included.
  OnceExit(root) {
    root.walkDecls((declaration) => {
      const { value } = declaration
      if (!value.includes('px') || value.includes('--app-zoom') || /url\(|["']/.test(value)) return
      const next = zoomed(value)
      if (next !== value) declaration.value = next
    })
  },
})
module.exports.postcss = true
module.exports.zoomed = zoomed
