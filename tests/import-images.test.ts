import assert from 'node:assert/strict'
import test from 'node:test'
import { planImageImport, transferImageFiles, validateImageFile } from '../lib/editor/import-images'
import { TEMPLATE_DEMO_IMAGE_NAME, TEMPLATE_DEMO_IMAGE_URL } from '../lib/templates/demo-media'

test('an import goes to the main image, the template, or new layers', () => {
  assert.equal(planImageImport({ imageName: null, uploadedImageUrl: null }), 'main')
  assert.equal(
    planImageImport({ imageName: TEMPLATE_DEMO_IMAGE_NAME, uploadedImageUrl: TEMPLATE_DEMO_IMAGE_URL }),
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
