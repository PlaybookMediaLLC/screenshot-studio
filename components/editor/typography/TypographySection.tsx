'use client'

import * as React from 'react'
import { getFontCSS } from '@/lib/constants/fonts'
import { loadTextFonts } from '@/lib/typography/load-text-fonts'
import { applyDesignChanges } from '@/lib/design/apply'
import { exportDesignDocument } from '@/lib/design/export'
import { useImageStore } from '@/lib/store'
import { TYPOGRAPHY_TEMPLATES, withTypographyLayout } from '@/lib/typography/templates'
import { SectionWrapper } from '../sections/SectionWrapper'
import { Button } from '@/components/ui/button'

const aspectCss = (width: number, height: number) => `${width} / ${height}`

/**
 * Headline and subheadline styles for marketing graphics and App Store
 * screenshots, previewed on the design itself.
 */
export function TypographySection() {
  React.useEffect(() => {
    // Fonts load once while cards already show their system fallback, without a render queue.
    void loadTextFonts(TYPOGRAPHY_TEMPLATES.flatMap((template) => template.layers)).catch(() => {})
  }, [])
  const canvas = useImageStore((state) => state.canvasDimensions)
  const aspect = canvas ? aspectCss(canvas.canvasW, canvas.canvasH) : '4 / 3'

  const apply = (templateId: string) => {
    const template = TYPOGRAPHY_TEMPLATES.find((candidate) => candidate.id === templateId)
    if (!template) return
    const current = exportDesignDocument({ keepLocalSources: true })
    const next = withTypographyLayout(current, template)
    void applyDesignChanges({ texts: next.texts, devices: next.devices, image: next.image }, (ref) => ref)
  }

  return (
    <SectionWrapper defaultOpen={false} title="Typography">
      <div className="grid grid-cols-2 gap-1.5">
        {TYPOGRAPHY_TEMPLATES.map((template) => (
          <Button variant="custom" size={null}
            aria-label={`Apply ${template.name} typography`}
            className="group flex flex-col items-stretch overflow-hidden rounded-md border border-foreground/10 text-left transition-colors hover:border-foreground/25"
            key={template.id}
            onClick={() => apply(template.id)}
            title={template.description}
            type="button"
          >
            <div className="bg-foreground/[0.04]" style={{ aspectRatio: aspect }}>
              <div className="flex h-full flex-col justify-center gap-2 overflow-hidden bg-slate-900 p-3 text-center">
                {template.layers.map((layer) => <span key={layer.role} style={{ fontFamily: getFontCSS(layer.fontFamily), fontWeight: layer.fontWeight, color: layer.color, fontSize: layer.role === 'headline' ? 15 : 9, lineHeight: layer.lineHeight ?? 1.2, letterSpacing: `${layer.letterSpacing ?? 0}em` }}>{layer.role === 'headline' ? 'Your next big thing' : layer.text}</span>)}
              </div>
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
