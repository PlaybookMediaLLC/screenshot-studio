'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { SidebarLink } from '@/components/platform-shell/SidebarLink'
import { useNearViewport } from '@/components/design/DocumentPreview'
import { ImageTemplatePreview } from '@/components/templates/ImageTemplateGallery'
import { AnimatedTemplatePreview } from '@/components/templates/AnimatedTemplateGallery'
import { RecipePreview } from '@/components/canvas-workspace/RecipePreview'
import { StoreTemplatePreview } from '@/components/store-screenshots/StoreTemplatePreview'
import { WorkflowTemplatePreview } from '@/components/workflows/WorkflowTemplatePreview'
import { DesignTemplatePreview } from '@/components/design/DesignTemplatePreview'
import { designTemplates } from '@/lib/design/templates'
import { IMAGE_TEMPLATES } from '@/lib/templates/image-templates'
import { ANIMATED_TEMPLATES } from '@/lib/animation/templates'
import { CANVAS_RECIPES, canvasRecipeSchema } from '@/lib/canvas/recipes'
import { BUILT_IN_TEMPLATES, type StoreTemplate } from '@/lib/store-screenshots/templates'
import { listSavedTemplates } from '@/lib/store-screenshots/persistence/library'
import { WORKFLOW_TEMPLATES, buildWorkflowTemplate } from '@/lib/workflows/templates'

const CATEGORIES = [
  'Screenshots',
  'Animated',
  'Layouts & presets',
  'Canvas',
  'Store screenshots',
  'Workflows',
] as const

function PreviewCard({
  name,
  description,
  href,
  action,
  children,
}: {
  name: string
  description: string
  href: string
  action: string
  children: ReactNode
}) {
  const [ref, near] = useNearViewport<HTMLDivElement>()
  return (
    <li className="flex min-w-0 flex-col overflow-hidden rounded-xl border bg-card">
      <div
        ref={ref}
        role="img"
        aria-label={`Preview of ${name}`}
        className="flex min-h-48 items-center justify-center overflow-hidden border-b bg-muted/30 p-3"
      >
        {near ? (
          <div className="w-full" aria-hidden="true">
            {children}
          </div>
        ) : (
          <span className="text-sm text-muted-foreground">Preview loads as you scroll</span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-3 p-5">
        <h3 className="font-medium">{name}</h3>
        <p className="flex-1 text-sm text-muted-foreground">{description}</p>
        <SidebarLink href={href} className="self-start text-sm underline underline-offset-4">
          {action}
        </SidebarLink>
      </div>
    </li>
  )
}

/** Shared browse-only catalog; applying a design stays in its original editor. */
export default function TemplateCatalog() {
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>('Screenshots')
  const [saved, setSaved] = useState<StoreTemplate[]>([])
  const [localError, setLocalError] = useState(false)
  useEffect(() => {
    if (category !== 'Store screenshots') return
    let cancelled = false
    listSavedTemplates().then(
      (items) => {
        if (!cancelled) {
          setSaved(items)
          setLocalError(false)
        }
      },
      () => {
        if (!cancelled) setLocalError(true)
      }
    )
    return () => {
      cancelled = true
    }
  }, [category])
  return (
    <section aria-label="Template previews" className="space-y-5">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Template categories">
        {CATEGORIES.map((item) => (
          <Button
            key={item}
            variant={category === item ? 'secondary' : 'ghost'}
            aria-pressed={category === item}
            onClick={() => setCategory(item)}
          >
            {item}
          </Button>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">
        Preview each template here, then choose and apply it in its editor. Browsing never changes
        your saved work.
      </p>
      {category === 'Store screenshots' ? (
        <p className="text-sm text-muted-foreground">
          Built-in templates and templates saved on this browser.
        </p>
      ) : null}
      {localError && category === 'Store screenshots' ? (
        <p role="alert" className="text-sm text-destructive">
          Saved templates could not load. Built-in templates are still available. Reopen this
          category to retry.
        </p>
      ) : null}
      <ul key={category} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {category === 'Screenshots'
          ? IMAGE_TEMPLATES.map((template) => (
              <PreviewCard
                key={template.preset.id}
                name={template.preset.name}
                description={template.preset.description}
                href="/"
                action="Open screenshot editor"
              >
                <ImageTemplatePreview template={template} />
              </PreviewCard>
            ))
          : null}
        {category === 'Animated'
          ? ANIMATED_TEMPLATES.map((template) => (
              <PreviewCard
                key={template.id}
                name={template.name}
                description={template.description}
                href="/"
                action="Open animation templates"
              >
                <AnimatedTemplatePreview template={template} active={false} />
              </PreviewCard>
            ))
          : null}
        {category === 'Layouts & presets'
          ? designTemplates
              .filter((template) => template.kind !== 'editor-template')
              .map((template) => (
                <PreviewCard
                  key={template.id}
                  name={template.name}
                  description={template.description}
                  href="/"
                  action="Open screenshot editor"
                >
                  <DesignTemplatePreview id={template.id} />
                </PreviewCard>
              ))
          : null}
        {category === 'Canvas'
          ? canvasRecipeSchema.options.map((recipe) => (
              <PreviewCard
                key={recipe}
                name={CANVAS_RECIPES[recipe].name}
                description={CANVAS_RECIPES[recipe].description}
                href={`/canvas/new?start=template&recipe=${recipe}`}
                action="Customize this Canvas"
              >
                <RecipePreview recipe={recipe} />
              </PreviewCard>
            ))
          : null}
        {category === 'Store screenshots'
          ? [...BUILT_IN_TEMPLATES, ...saved].map((template) => (
              <PreviewCard
                key={template.id}
                name={template.name}
                description={template.description}
                href="/?editor=app-store"
                action="Open store studio"
              >
                <StoreTemplatePreview template={template} />
              </PreviewCard>
            ))
          : null}
        {category === 'Workflows'
          ? WORKFLOW_TEMPLATES.map((template) => (
              <PreviewCard
                key={template.id}
                name={template.name}
                description={template.description}
                href="/workflows/new"
                action="Configure a workflow"
              >
                <WorkflowTemplatePreview
                  name={template.name}
                  {...buildWorkflowTemplate(template.id, {
                    brandKitId: '',
                    destinationIds: [],
                    creditLimit: 0,
                    branch: 'main',
                    aiRelevance: false,
                    majorMinorOnly: template.versioned,
                    renderTemplateIds: [],
                    canvas: false,
                  })}
                />
              </PreviewCard>
            ))
          : null}
      </ul>
    </section>
  )
}
