'use client'

import * as React from 'react'
import { DocumentPreview } from '@/components/design/DocumentPreview'
import { applyDesignChanges } from '@/lib/design/apply'
import { exportDesignDocument } from '@/lib/design/export'
import { useEditorDocument } from '@/lib/design/use-editor-document'
import { useImageStore } from '@/lib/store'
import { TYPOGRAPHY_TEMPLATES, withTypographyTemplate } from '@/lib/typography/templates'
import { SectionWrapper } from '../sections/SectionWrapper'
import { Button } from '@/components/ui/button'

const aspectCss = (width: number, height: number) => `${width} / ${height}`

/**
 * Headline and subheadline styles for marketing graphics and App Store
 * screenshots, previewed on the design itself.
 */
export function TypographySection() {
  const document = useEditorDocument()
  const canvas = useImageStore((state) => state.canvasDimensions)
  const aspect = canvas ? aspectCss(canvas.canvasW, canvas.canvasH) : '4 / 3'

  const apply = (templateId: string) => {
    const template = TYPOGRAPHY_TEMPLATES.find((candidate) => candidate.id === templateId)
    if (!template) return
    const current = exportDesignDocument({ keepLocalSources: true })
    void applyDesignChanges({ texts: withTypographyTemplate(current.texts, template) }, (ref) => ref)
  }

  return (
    <SectionWrapper defaultOpen={false} title="Typography">
      <div className="grid grid-cols-2 gap-1.5">
        {TYPOGRAPHY_TEMPLATES.map((template) => (
          <Button variant="custom" size={null}
            aria-label={`Apply ${template.name} typography`}
            className="group overflow-hidden rounded-md border border-foreground/10 text-left transition-colors hover:border-foreground/25"
            key={template.id}
            onClick={() => apply(template.id)}
            title={template.description}
            type="button"
          >
            <div className="bg-foreground/[0.04]" style={{ aspectRatio: aspect }}>
              <DocumentPreview
                alt={`${template.name} typography`}
                document={document ? { ...document, texts: withTypographyTemplate(document.texts, template) } : null}
              />
            </div>
            <p className="truncate px-1.5 py-1 text-[10px] font-medium text-muted-foreground group-hover:text-foreground">
              {template.name}
              {template.use === 'app-store' ? ' · App Store' : ''}
            </p>
          </Button>
        ))}
      </div>
    </SectionWrapper>
  )
}
