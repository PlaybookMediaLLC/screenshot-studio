import assert from 'node:assert/strict'
import test from 'node:test'
import {
  importImages,
  planImageImport,
  transferImageFiles,
  validateImageContents,
  validateImageFile,
} from '../lib/editor/import-images'
import { TEMPLATE_DEMO_IMAGE_NAME, TEMPLATE_DEMO_IMAGE_URL } from '../lib/templates/demo-media'

test('an import goes to the main image, the template, or new layers', () => {
  assert.equal(planImageImport({ imageName: null, uploadedImageUrl: null }), 'main')
  assert.equal(
    planImageImport({
      imageName: TEMPLATE_DEMO_IMAGE_NAME,
      uploadedImageUrl: TEMPLATE_DEMO_IMAGE_URL,
    }),
    'template-media'
  )
  assert.equal(planImageImport({ imageName: 'a.png', uploadedImageUrl: 'blob:x' }), 'layers')
})

test('only supported images under the size limit import', () => {
  assert.equal(validateImageFile({ size: 1000, type: 'image/png' }), null)
  assert.match(validateImageFile({ size: 1000, type: 'image/svg+xml' }) ?? '', /not supported/)
  assert.match(validateImageFile({ size: 1e10, type: 'image/png' }) ?? '', /too large/)
})

test('a transfer yields each image file once', () => {
  const png = new File(['x'], 'a.png', { type: 'image/png' })
  const text = new File(['x'], 'a.txt', { type: 'text/plain' })
  assert.deepEqual(transferImageFiles({ files: [png, text] as unknown as FileList }), [png])
  assert.deepEqual(transferImageFiles(null), [])
})

test('a text file renamed as PNG is rejected before any slide or history is added', async () => {
  const { useImageStore } = await import('../lib/store')
  const before = useImageStore.getState()
  const file = new File(['not an image at all'], 'broken.png', { type: 'image/png' })
  assert.match((await validateImageContents(file)) ?? '', /not a valid/)
  const result = await importImages([file], true)
  assert.equal(result.imported, 0)
  assert.equal(result.rejected[0].name, 'broken.png')
  assert.equal(useImageStore.getState(), before)
})
