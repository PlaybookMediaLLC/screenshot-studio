import type { DesignDocument } from '@/lib/design/document'
import { documentCanvasSize, screenshotBox } from '@/lib/export/adapt'
import type { ElementOf } from '@/lib/editor/elements/schema'
import type { FocusRegion, StorySource } from './document'

/** Match the selected evidence to the screenshot as drawn, including its native scale. */
export function resolveFocus(
  document: DesignDocument,
  source: StorySource,
  focus: FocusRegion,
  callout: ElementOf<'callout'>
) {
  const image = screenshotBox(document, documentCanvasSize(document), source.width / source.height)
  if (!image) return
  const zoom = Math.min(
    10,
    Math.max(
      1,
      callout.width / image.width,
      callout.height / image.height,
      Math.min(
        callout.width / (image.width * focus.width),
        callout.height / (image.height * focus.height)
      )
    )
  )
  const halfWidth = Math.min(0.5, callout.width / (image.width * zoom) / 2)
  const halfHeight = Math.min(0.5, callout.height / (image.height * zoom) / 2)
  callout.props.zoom = zoom
  callout.props.source = {
    x: Math.max(halfWidth, Math.min(1 - halfWidth, focus.x + focus.width / 2)),
    y: Math.max(halfHeight, Math.min(1 - halfHeight, focus.y + focus.height / 2)),
  }
}
