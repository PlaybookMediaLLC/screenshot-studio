import type { Page } from '@playwright/test'
import { configureE2EFlow, expect, test } from './framework/flow'
import { getE2EUrl } from './framework/auth'
import { createCreativeSet } from '@/lib/creative-sets/recipes'
import { TREATMENTS, type Treatment } from '@/lib/creative-sets/document'
import type { DesignDocument } from '@/lib/design/document'
import type { RenderResponse } from '@/lib/render/protocol'

configureE2EFlow()
test.setTimeout(180_000)

async function render(page: Page, document: DesignDocument) {
  return page.evaluate(
    (serialized) =>
      new Promise<Exclude<RenderResponse, { type: 'ready' }>>((resolve) => {
        const id = crypto.randomUUID()
        const receive = (event: MessageEvent<RenderResponse>) => {
          if ((event.data.type !== 'result' && event.data.type !== 'error') || event.data.id !== id)
            return
          window.removeEventListener('message', receive)
          resolve(event.data)
        }
        window.addEventListener('message', receive)
        window.postMessage(
          {
            type: 'render',
            id,
            document: JSON.parse(serialized),
            output: { format: 'png', strict: true, maxWidth: 480 },
          },
          location.origin
        )
      }),
    JSON.stringify(document)
  )
}

test('all twelve Story Set recipes render within measured bounds; actual clipping is rejected', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1200 })
  await page.addInitScript(() => {
    window.addEventListener('message', (event) => {
      if (event.data?.type === 'ready') document.documentElement.dataset.renderReady = 'true'
    })
  })
  await page.goto(getE2EUrl('/render/local'), { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => document.documentElement.dataset.renderReady === 'true')
  await expect(page.locator('[data-canvas-viewport]')).toBeVisible()
  for (const treatment of Object.keys(TREATMENTS) as Treatment[]) {
    const set = createCreativeSet({
      headline: 'See what needs your decision',
      supporting: 'Projects, docs and decisions in one place.',
      treatment,
      focus: { x: 0.32, y: 0.71, width: 0.46, height: 0.22 },
      source: {
        id: 'proof',
        src: 'asset:11111111-1111-4111-8111-111111111111',
        name: 'proof.webp',
        revision: 1,
        width: 1600,
        height: 987,
      },
    })
    for (const output of set.outputs) {
      output.document.image.src = '/demo/notion-showcase.webp'
      const result = await render(page, output.document)
      expect(
        result.type,
        `${treatment} / ${output.format}: ${result.type === 'error' ? result.message : ''}`
      ).toBe('result')
      if (result.type === 'result') {
        expect(result.width).toBe(480)
        expect(result.height).toBe(
          Math.round(
            (480 * output.document.canvas!.size!.height) / output.document.canvas!.size!.width
          )
        )
      }
    }
    const invalid = structuredClone(set.outputs[0]!.document)
    invalid.texts[0]!.visible = true
    invalid.texts[0]!.position.x = -20
    const result = await render(page, invalid)
    expect(result.type).toBe('error')
    if (result.type === 'error') {
      expect(result.message).toContain('See what needs your decision')
      expect(result.message).toContain('extends beyond')
      expect(result.message).not.toContain(invalid.texts[0]!.id!)
    }
  }
})
