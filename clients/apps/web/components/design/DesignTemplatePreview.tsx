'use client'

import { useMemo } from 'react'
import { getDesignTemplate, TEMPLATE_DEMO_SLOTS } from '@/lib/design/templates'
import { DocumentPreview } from './DocumentPreview'

/** Native template rendering with clearly illustrative copy and bundled public media. */
export function DesignTemplatePreview({ id }: { id: string }) {
  const template = getDesignTemplate(id)
  const document = useMemo(() => template?.build(TEMPLATE_DEMO_SLOTS) ?? null, [template])
  return (
    <div className="aspect-video w-full overflow-hidden rounded-md bg-muted/30">
      {template ? (
        <DocumentPreview alt={`Preview of ${template.name}`} document={document} />
      ) : (
        <p className="p-3 text-xs text-muted-foreground">Preview unavailable for this template.</p>
      )}
    </div>
  )
}
