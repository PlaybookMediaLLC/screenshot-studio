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
