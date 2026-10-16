import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ChromeFrame } from '@/components/frames/ChromeFrame'
import { CodeScreen } from '@/components/frames/CodeScreen'
import { getMockupDefinition } from '@/lib/constants/mockups'
import {
  averageLuminance,
  relativeLuminance,
  resolveAppearance,
  toneForLuminance,
} from '@/lib/frames/appearance'
import { codeAspect, codeMetrics, createCodeContent, normalizeCode } from '@/lib/frames/code'
import { DRAWN_DEVICE_DEFINITIONS, deviceArtGeometry } from '@/lib/frames/devices'
import {
  chromeBoxForContent,
  chromeContentRect,
  deviceGeometry,
  frameScreenRect,
  screenBoxAspect,
} from '@/lib/frames/geometry'
import { compositionLayoutSchema, layoutScreens } from '@/lib/frames/layouts'
import {
  browserSchema,
  DEFAULT_FRAME_CHROME,
  deviceOrientationSchema,
  frameChromeSchema,
  windowStyleSchema,
} from '@/lib/frames/schema'

const close = (actual: number, expected: number, message?: string) =>
  assert.ok(Math.abs(actual - expected) < 1e-6, `${message ?? ''} ${actual} ≠ ${expected}`)

// ── Layouts ──────────────────────────────────────────────────────────────────

const MIXED_ASPECTS = [16 / 10, 0.46, 4 / 3, 1, 0.75, 1.9]

function boxes(
  slots: ReturnType<typeof layoutScreens>,
  aspects: readonly number[],
  canvasAspect: number
) {
  return slots.map((slot, index) => {
    const width = slot.size * canvasAspect
    const height = width / aspects[index]!
    return {
      bottom: slot.y + height / 2,
      left: slot.x * canvasAspect - width / 2,
      right: slot.x * canvasAspect + width / 2,
      top: slot.y - height / 2,
      height,
      width,
    }
  })
}

for (const layout of compositionLayoutSchema.options) {
  for (const canvasAspect of [4 / 3, 16 / 9, 9 / 16, 1]) {
    test(`${layout} lays out 1–6 screens inside a ${canvasAspect.toFixed(2)} canvas`, () => {
      for (let count = 1; count <= MIXED_ASPECTS.length; count++) {
        const aspects = MIXED_ASPECTS.slice(0, count)
        const slots = layoutScreens(layout, aspects, canvasAspect)
        assert.equal(slots.length, count)
        const placed = boxes(slots, aspects, canvasAspect)
        for (const box of placed) {
          assert.ok(box.width > 0 && box.height > 0)
          if (layout === 'fan') continue // rotated cards may poke past their unrotated box
          assert.ok(
            box.left >= -1e-9 && box.right <= canvasAspect + 1e-9,
            `${layout} x inside canvas`
          )
          assert.ok(box.top >= -1e-9 && box.bottom <= 1 + 1e-9, `${layout} y inside canvas`)
        }
        if (layout === 'fan') {
          const rotations = slots.map((slot) => slot.rotation)
          assert.deepEqual(
            rotations,
            [...rotations].reverse().map((rotation) => -rotation || 0)
          )
          continue
        }
        // Nothing overlaps except in a fan.
        for (let a = 0; a < placed.length; a++) {
          for (let b = a + 1; b < placed.length; b++) {
            const one = placed[a]!
            const two = placed[b]!
            const overlapX = Math.min(one.right, two.right) - Math.max(one.left, two.left)
            const overlapY = Math.min(one.bottom, two.bottom) - Math.max(one.top, two.top)
            assert.ok(
              overlapX <= 1e-9 || overlapY <= 1e-9,
              `${layout}: screens ${a} and ${b} overlap`
            )
          }
        }
      }
    })
  }
}

test('side by side keeps one height, stack keeps one width', () => {
  const aspects = [1.6, 0.5, 1]
  const row = boxes(layoutScreens('side-by-side', aspects, 16 / 9), aspects, 16 / 9)
  row.forEach((box) => close(box.height, row[0]!.height))
  assert.ok(row[0]!.left < row[1]!.left && row[1]!.left < row[2]!.left)
  const column = boxes(layoutScreens('stack', aspects, 9 / 16), aspects, 9 / 16)
  column.forEach((box) => close(box.width, column[0]!.width))
  assert.ok(column[0]!.top < column[1]!.top)
})

test('bento makes the first screen the largest', () => {
  const aspects = [1.6, 1.6, 1.6]
  const placed = boxes(layoutScreens('bento', aspects, 4 / 3), aspects, 4 / 3)
  assert.ok(placed[0]!.width > placed[1]!.width && placed[0]!.width > placed[2]!.width)
})

// ── Chrome geometry ──────────────────────────────────────────────────────────

const chromes = [
  ...browserSchema.options.flatMap((browser) => [
    { kind: 'browser' as const, chrome: { ...DEFAULT_FRAME_CHROME, browser } },
    {
      kind: 'browser' as const,
      chrome: {
        ...DEFAULT_FRAME_CHROME,
        browser,
        showBookmarks: true,
        tabs: ['Home', 'Docs', 'Pricing'],
      },
    },
  ]),
  ...windowStyleSchema.options.map((window) => ({
    kind: 'window' as const,
    chrome: { ...DEFAULT_FRAME_CHROME, window },
  })),
]

test('every browser and window frame finds its content again inside its box', () => {
  for (const { chrome, kind } of chromes) {
    for (const content of [
      { height: 600, width: 960 },
      { height: 844, width: 390 },
    ]) {
      const box = chromeBoxForContent(kind, chrome, content)
      assert.ok(
        box.insets.top > 0 || box.insets.left > 0,
        `${kind} ${chrome.browser}/${chrome.window} has chrome`
      )
      const rect = chromeContentRect(kind, chrome, {
        height: box.height,
        width: box.width,
        x: 10,
        y: 20,
      })
      close(rect.width, content.width, `${kind} width`)
      close(rect.height, content.height, `${kind} height`)
      close(rect.x, 10 + box.insets.left)
      close(rect.y, 20 + box.insets.top)
    }
  }
})

test('tabs and a bookmarks bar make browser chrome taller; Arc grows a sidebar', () => {
  const plain = chromeBoxForContent('browser', DEFAULT_FRAME_CHROME, { height: 600, width: 1000 })
  const busy = chromeBoxForContent(
    'browser',
    frameChromeSchema.parse({ showBookmarks: true, tabs: ['A', 'B'] }),
    { height: 600, width: 1000 }
  )
  assert.ok(busy.insets.top > plain.insets.top)
  const arc = chromeBoxForContent(
    'browser',
    { ...DEFAULT_FRAME_CHROME, browser: 'arc' },
    { height: 600, width: 1000 }
  )
  assert.ok(arc.insets.left > arc.insets.right)
  // Chrome scales with the content, so a frame keeps its proportions at any size.
  const large = chromeBoxForContent('browser', DEFAULT_FRAME_CHROME, { height: 1200, width: 2000 })
  close(large.insets.top / plain.insets.top, 2)
})

// ── Devices ──────────────────────────────────────────────────────────────────

test('every drawn device has a screen inside its body, in each orientation', () => {
  assert.equal(DRAWN_DEVICE_DEFINITIONS.length, 8)
  for (const definition of DRAWN_DEVICE_DEFINITIONS) {
    const art = definition.art!
    assert.ok(art.colors.length >= 1)
    for (const orientation of deviceOrientationSchema.options) {
      const geometry = deviceArtGeometry(art, orientation)
      const { screen } = geometry
      assert.ok(screen.x >= 0 && screen.y >= 0, definition.id)
      assert.ok(
        screen.x + screen.width <= geometry.width + 1e-9,
        `${definition.id} ${orientation} width`
      )
      assert.ok(
        screen.y + screen.height <= geometry.height + 1e-9,
        `${definition.id} ${orientation} height`
      )
      const supported = art.orientations.includes(orientation)
      if (supported && orientation !== art.orientations[0] && geometry.rotated) {
        close(geometry.width, art.height)
        close(screen.width / screen.height, art.screen.height / art.screen.width)
      }
      if (!supported)
        assert.equal(geometry.width, art.width, `${definition.id} falls back to native`)
    }
  }
})

test('frameScreenRect places a device screen where the device draws it', () => {
  const pixel = getMockupDefinition('pixel-9-pro')!
  for (const orientation of deviceOrientationSchema.options) {
    const { aspectRatio, screen } = deviceGeometry(pixel, orientation)
    const box = { height: 1000 / aspectRatio, width: 1000, x: 50, y: 70 }
    const rect = frameScreenRect({ definitionId: 'pixel-9-pro', kind: 'device', orientation }, box)
    close(rect.x, 50 + screen.x * 1000)
    close(rect.width / rect.height, (screen.width * box.width) / (screen.height * box.height))
    if (orientation === 'landscape') assert.ok(rect.width > rect.height)
    else assert.ok(rect.height > rect.width)
  }
  // PNG devices use their asset's screen.
  const iphone = getMockupDefinition('iphone-17-pro-front')!
  const rect = frameScreenRect(
    { definitionId: iphone.id, kind: 'device' },
    { height: 100, width: 50, x: 0, y: 0 }
  )
  close(rect.x, iphone.asset!.screen.x * 50)
  // No frame: the screen is the box.
  assert.deepEqual(frameScreenRect({ kind: 'none' }, { height: 3, width: 4, x: 1, y: 2 }), {
    height: 3,
    width: 4,
    x: 1,
    y: 2,
  })
})

test('a screen box follows its frame: device aspect, or content plus chrome', () => {
  const screen = { aspect: 2 }
  assert.equal(screenBoxAspect({ definitionId: 'pixel-9-pro', screen }), 72 / 152.8)
  assert.equal(screenBoxAspect({ definitionId: 'pixel-9-pro', frame: { kind: 'none' }, screen }), 2)
  const browser = screenBoxAspect({
    definitionId: 'pixel-9-pro',
    frame: { chrome: DEFAULT_FRAME_CHROME, kind: 'browser' },
    screen,
  })
  assert.ok(browser < 2 && browser > 1.5)
})

// ── Appearance ───────────────────────────────────────────────────────────────

test('auto appearance follows the luminance of the content', () => {
  close(relativeLuminance(255, 255, 255), 1)
  close(relativeLuminance(0, 0, 0), 0)
  assert.equal(toneForLuminance(relativeLuminance(255, 255, 255)), 'light')
  assert.equal(toneForLuminance(relativeLuminance(24, 24, 27)), 'dark')
  assert.equal(toneForLuminance(relativeLuminance(128, 128, 128)), 'light')
  assert.equal(toneForLuminance(relativeLuminance(90, 90, 90)), 'dark')
  // Transparent pixels read as the light canvas behind them.
  assert.equal(averageLuminance([0, 0, 0, 0, 0, 0, 0, 0]), 1)
  assert.equal(toneForLuminance(averageLuminance([20, 20, 20, 255, 30, 30, 30, 255])), 'dark')
  assert.equal(resolveAppearance('auto', 'dark'), 'dark')
  assert.equal(resolveAppearance('auto', undefined), 'light')
  assert.equal(resolveAppearance('light', 'dark'), 'light')
})

// ── Code ─────────────────────────────────────────────────────────────────────

test('code renders as highlighted tokens, line numbers, and the chosen font, filling its screen', () => {
  const content = createCodeContent('const answer = 42\nexport default answer')
  const html = renderToStaticMarkup(createElement(CodeScreen, { content, height: 300, width: 600 }))
  assert.match(
    html,
    /class="token" style="color:hsl\(286, 60%, 67%\)">const</,
    'One Dark colors keywords'
  )
  assert.match(html, /class="token" style="color:hsl\(29, 54%, 61%\)">42</, 'and numbers')
  assert.match(html, /linenumber/, 'line numbers are drawn')
  assert.match(html, /font-family:&quot;JetBrains Mono&quot;/)
  assert.match(html, /background:#282c34/)
  const metrics = codeMetrics(content)
  const fontSize = Math.min(600 / metrics.widthEm, 300 / metrics.heightEm)
  assert.match(html, new RegExp(`font-size:${String(fontSize).slice(0, 8).replace('.', '\\.')}`))

  const plain = renderToStaticMarkup(
    createElement(CodeScreen, {
      content: { ...content, language: 'text', lineNumbers: false, theme: 'github' },
      height: 300,
      width: 600,
    })
  )
  assert.doesNotMatch(plain, /class="token"/, 'plain text is not highlighted')
  assert.doesNotMatch(plain, /linenumber/)
  assert.match(plain, /background:#ffffff/)
})

test('one chrome renderer draws every browser and window, light and dark', () => {
  for (const tone of ['light', 'dark'] as const) {
    for (const { chrome, kind } of chromes) {
      const html = renderToStaticMarkup(
        createElement(
          ChromeFrame,
          {
            frame: { chrome: { ...chrome, address: 'acme.dev/pricing', title: 'Build' }, kind },
            height: 500,
            tone,
            width: 800,
          },
          createElement('img', { alt: 'content' })
        )
      )
      assert.match(html, /data-frame-screen="true"/)
      assert.match(html, /alt="content"/)
      if (kind === 'browser') {
        assert.match(html, new RegExp(`data-frame-chrome="${chrome.browser}"`))
        assert.match(html, /acme\.dev/, `${chrome.browser} shows its address`)
        if (chrome.tabs.length > 1)
          assert.match(html, /Pricing/, `${chrome.browser} shows its tabs`)
        assert.equal(
          html.includes('data-bookmarks'),
          chrome.showBookmarks,
          `${chrome.browser} bookmarks bar`
        )
      } else {
        assert.match(html, new RegExp(`data-frame-chrome="${chrome.window}"`))
        if (chrome.window !== 'terminal-minimal')
          assert.match(html, /Build/, `${chrome.window} shows its title`)
      }
    }
  }
})

test('code screens are sized from their text', () => {
  assert.equal(normalizeCode('a\r\n\tb\n\n'), 'a\n  b')
  const short = codeMetrics({ code: 'ls', lineNumbers: false, padding: 1 })
  assert.equal(short.columns, 28, 'short code keeps a minimum width')
  const wide = codeMetrics({
    code: 'x'.repeat(80) + '\n'.repeat(9) + 'y',
    lineNumbers: true,
    padding: 1,
  })
  assert.equal(wide.lines, 10)
  assert.equal(wide.columns, 81)
  assert.ok(wide.gutterEm > 0)
  assert.ok(
    codeAspect({ code: 'x'.repeat(80), lineNumbers: false, padding: 1 }) >
      codeAspect({ code: 'x\n'.repeat(30) + 'x', lineNumbers: false, padding: 1 })
  )
})
