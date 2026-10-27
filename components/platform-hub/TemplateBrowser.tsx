'use client'

import dynamic from 'next/dynamic'

const TemplateCatalog = dynamic(() => import('./TemplateCatalog'), {
  loading: () => (
    <p role="status" className="text-sm text-muted-foreground">
      Loading template previews…
    </p>
  ),
})

export function TemplateBrowser() {
  return <TemplateCatalog />
}

const TemplateStripLazy = dynamic(
  () => import('./TemplateCatalog').then((catalog) => catalog.TemplateStrip),
  { loading: () => <div className="studio-grid min-h-48" aria-hidden="true" /> }
)

/** A few templates to start from, loaded with the catalog's previews. */
export function TemplateHighlights() {
  return <TemplateStripLazy />
}
