import assert from 'node:assert/strict'
import test from 'node:test'
import JSZip from 'jszip'
import { batchEntryPath, designFileName } from '@/lib/export/naming'
import { canvasTarget, getSizePreset } from '@/lib/export/sizes'
import { rasterSvg } from '@/lib/export/svg'
import { zipFiles } from '@/lib/export/zip'

const bytes = (...values: number[]) => new Uint8Array(values)

test('a batch ZIP has one folder per size and every item in each', async () => {
  const sizes = [getSizePreset('instagram-square')!, getSizePreset('open-graph')!]
  const items = ['home.png', 'settings page.png', 'home.png']
  const entries = sizes.flatMap((target) =>
    items.map((name, index) => ({
      data: bytes(index, target.width % 256),
      path: batchEntryPath({ format: 'png', index, name, target, total: items.length }),
    }))
  )
  const zip = await JSZip.loadAsync(await (await zipFiles(entries)).arrayBuffer())
  const files = Object.values(zip.files)
    .filter((file) => !file.dir)
    .map((file) => file.name)
    .sort()
  assert.deepEqual(files, [
    'instagram-square-1080x1080/1-home.png',
    'instagram-square-1080x1080/2-settings-page.png',
    'instagram-square-1080x1080/3-home.png',
    'open-graph-1200x630/1-home.png',
    'open-graph-1200x630/2-settings-page.png',
    'open-graph-1200x630/3-home.png',
  ])
  assert.deepEqual(
    [...(await zip.file('open-graph-1200x630/2-settings-page.png')!.async('uint8array'))],
    [1, 1200 % 256]
  )
})

test('a multi-size design ZIP is flat and keeps SVG text compressed', async () => {
  const svg = rasterSvg(bytes(0x89, 0x50, 0x4e, 0x47), { height: 1080, width: 1920 })
  const blob = await zipFiles([
    {
      data: new TextEncoder().encode(svg),
      path: designFileName('launch', 'svg', canvasTarget(1920, 1080)),
    },
    { data: bytes(1), path: designFileName('launch', 'png', getSizePreset('x-post')!) },
  ])
  assert.equal(blob.type, 'application/zip')
  const zip = await JSZip.loadAsync(await blob.arrayBuffer())
  assert.deepEqual(Object.keys(zip.files).sort(), [
    'launch-1920x1080.svg',
    'launch-x-post-1600x900.png',
  ])
  assert.equal(await zip.file('launch-1920x1080.svg')!.async('string'), svg)
})

test('unsafe or colliding names never reach the archive', async () => {
  for (const path of ['../evil.png', '/abs.png', 'a//b.png', 'a/./b.png', 'c:\\x.png', '']) {
    await assert.rejects(zipFiles([{ data: bytes(1), path }]), /Unsafe file name/, path)
  }
  await assert.rejects(
    zipFiles([
      { data: bytes(1), path: 'a/Shot.png' },
      { data: bytes(2), path: 'a/shot.png' },
    ]),
    /share the name/
  )
  await assert.rejects(zipFiles([]), /nothing to put/)
})

test('a raster SVG embeds the PNG at the output size', () => {
  const svg = rasterSvg(bytes(1, 2, 3), { height: 627.4, width: 1200 })
  assert.match(
    svg,
    /^<\?xml version="1.0" encoding="UTF-8"\?>\n<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/
  )
  assert.match(svg, /width="1200" height="627" viewBox="0 0 1200 627"/)
  assert.ok(
    svg.includes(`href="data:image/png;base64,${Buffer.from([1, 2, 3]).toString('base64')}"`)
  )
})
