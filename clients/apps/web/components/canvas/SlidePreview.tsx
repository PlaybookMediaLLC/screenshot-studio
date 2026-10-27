'use client'

import { DocumentPreview } from '@/components/design/DocumentPreview'
import { slidePreviewDocument } from '@/lib/design/slide-preview'
import { useEditorDocument } from '@/lib/design/use-editor-document'
import type { StageOutput } from '@/lib/render/capture'

const output: StageOutput = { format: 'jpeg', maxWidth: 240, quality: 'medium' }

/** A slide thumbnail includes its frame, background, text and composition layers. */
export function SlidePreview({ src }: { src: string }) {
  const document = useEditorDocument(300)
  return <DocumentPreview alt="Slide design" document={document ? slidePreviewDocument(document, src) : null} output={output} />
}
