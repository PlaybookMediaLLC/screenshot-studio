'use client'

import { useRouter } from 'next/navigation'
import { type FormEvent, type ReactNode, useRef, useState } from 'react'
import { Group, Row, Section } from '@/components/platform-ui'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { getErrorMessage } from '@/components/workspace/settings-client'
import { trackEvent } from '@/lib/analytics'
import { useTRPCClient } from '@/lib/trpc/react'
import { productEnvironments } from '@/lib/tenant/schemas'

/**
 * The short path from "what product, what shipped" to a saved campaign
 * draft. Each step is persisted before the next runs, and a retry reuses
 * what already exists: a created product is selected, and the release is
 * created with a stable idempotency key, so resubmitting never duplicates.
 */

type Surface = { environment: string; id: string; name: string; url: string }

type CampaignSetupFormProps = {
  canCreate: boolean
  canManageProducts: boolean
  surfaces: Surface[]
}

const NEW_PRODUCT = 'new'

const inputClassName = 'h-10 rounded-lg'
const textareaClassName = 'min-h-24 rounded-lg'
const selectClassName =
  'h-10 w-full rounded-lg border border-input bg-transparent px-3 text-sm disabled:opacity-50 dark:bg-input/30'

/** A label above its control, inside a free-form Row. */
function Field({
  children,
  htmlFor,
  label,
}: {
  children: ReactNode
  htmlFor: string
  label: string
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  )
}

function field(data: FormData, name: string): string {
  return String(data.get(name) ?? '').trim()
}

function parseSourceUrls(value: string): string[] {
  return value
    .split(/\s+/)
    .map((url) => url.trim())
    .filter(Boolean)
}

export function CampaignSetupForm({
  canCreate,
  canManageProducts,
  surfaces: initialSurfaces,
}: CampaignSetupFormProps) {
  const router = useRouter()
  const trpcClient = useTRPCClient()
  const startedAt = useRef(Date.now())
  const [idempotencyKey] = useState(() => crypto.randomUUID())
  const [surfaces, setSurfaces] = useState(initialSurfaces)
  const [surfaceChoice, setSurfaceChoice] = useState(
    initialSurfaces[0]?.id ?? (canManageProducts ? NEW_PRODUCT : '')
  )
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const isNewProduct = surfaceChoice === NEW_PRODUCT

  async function createProduct(data: FormData): Promise<string> {
    const name = field(data, 'productName')
    const { productSurface } = await trpcClient.productSurface.create.mutate({
      environment: field(data, 'environment') as (typeof productEnvironments)[number],
      name,
      url: field(data, 'appUrl'),
    })
    const marketingUrl = field(data, 'marketingUrl')
    if (marketingUrl) {
      await trpcClient.productSurface.create.mutate({
        name: `${name} marketing site`,
        url: marketingUrl,
      })
    }
    trackEvent('product_surface_created', { source: 'campaign_setup' })
    // Select the new surface so a retry after a later failure reuses it
    // instead of colliding with the name it just took.
    setSurfaces((current) => [...current, productSurface])
    setSurfaceChoice(productSurface.id)
    return productSurface.id
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setError(null)
    setIsSaving(true)
    const data = new FormData(event.currentTarget)
    try {
      const productSurfaceId = isNewProduct ? await createProduct(data) : surfaceChoice || undefined
      const title = field(data, 'title')
      const benefitStatement = field(data, 'benefitStatement')
      const audience = field(data, 'audience')
      const { release } = await trpcClient.release.create.mutate({
        audience: audience || undefined,
        benefitStatement,
        description: field(data, 'description') || undefined,
        idempotencyKey,
        productSurfaceId,
        sourceUrls: parseSourceUrls(field(data, 'sourceUrls')),
        title,
      })
      trackEvent('release_created', { source: 'campaign_setup' })
      const { campaign } = await trpcClient.campaign.create.mutate({
        audience: audience || undefined,
        name: title,
        // The release may skip why it matters when sources are linked; a
        // campaign still needs an objective, so the title stands in.
        objective: benefitStatement || title,
        releaseId: release.id,
      })
      trackEvent('campaign_draft_created', {
        elapsedSeconds: Math.round((Date.now() - startedAt.current) / 1_000),
      })
      router.push(`/campaigns/${campaign.id}`)
    } catch (requestError) {
      setError(getErrorMessage(requestError))
      setIsSaving(false)
    }
  }

  if (!canCreate) {
    return (
      <p className="text-sm text-neutral-500">
        Your role cannot create campaigns. Ask a workspace admin for creator access.
      </p>
    )
  }

  return (
    <form className="flex flex-col gap-10" onSubmit={handleSubmit}>
      <Section description="The app this campaign captures and promotes." title="Product">
        <Group>
          <Row>
            <Field htmlFor="campaign-product" label="Product">
              <select
                className={selectClassName}
                id="campaign-product"
                onChange={(event) => setSurfaceChoice(event.target.value)}
                value={surfaceChoice}
              >
                {surfaces.map((surface) => (
                  <option key={surface.id} value={surface.id}>
                    {surface.name} ({surface.environment})
                  </option>
                ))}
                {canManageProducts ? <option value={NEW_PRODUCT}>Add a product…</option> : null}
                {!canManageProducts && surfaces.length === 0 ? (
                  <option value="">No product connected</option>
                ) : null}
              </select>
            </Field>
          </Row>
          {isNewProduct ? (
            <Row>
              <Field htmlFor="campaign-product-name" label="Product name">
                <Input
                  className={inputClassName}
                  id="campaign-product-name"
                  maxLength={160}
                  name="productName"
                  required
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
                <Field htmlFor="campaign-app-url" label="App URL">
                  <Input
                    className={inputClassName}
                    id="campaign-app-url"
                    name="appUrl"
                    placeholder="https://app.example.com"
                    required
                    type="url"
                  />
                </Field>
                <Field htmlFor="campaign-environment" label="Environment">
                  <select
                    className={selectClassName}
                    defaultValue="production"
                    id="campaign-environment"
                    name="environment"
                  >
                    {productEnvironments.map((environment) => (
                      <option key={environment} value={environment}>
                        {environment}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <Field htmlFor="campaign-marketing-url" label="Marketing site URL (optional)">
                <Input
                  className={inputClassName}
                  id="campaign-marketing-url"
                  name="marketingUrl"
                  placeholder="https://example.com"
                  type="url"
                />
              </Field>
            </Row>
          ) : null}
        </Group>
      </Section>

      <Section description="What did you ship? This becomes the campaign brief." title="Release">
        <Group>
          <Row>
            <Field htmlFor="campaign-release-title" label="Release title">
              <Input
                className={inputClassName}
                id="campaign-release-title"
                maxLength={160}
                name="title"
                required
              />
            </Field>
            <Field htmlFor="campaign-benefit" label="Why it matters">
              <Input
                aria-describedby="campaign-benefit-hint"
                className={inputClassName}
                id="campaign-benefit"
                maxLength={500}
                name="benefitStatement"
                placeholder="One sentence on what this changes for your users"
              />
              <p className="text-xs text-neutral-500" id="campaign-benefit-hint">
                Can be left empty when you add a source link; the AI drafts it from your sources.
              </p>
            </Field>
          </Row>
          <Row>
            <Field htmlFor="campaign-description" label="Description">
              <Textarea
                className={textareaClassName}
                id="campaign-description"
                maxLength={10_000}
                name="description"
                placeholder="What changed, in your own words. Plain text."
              />
            </Field>
            <Field htmlFor="campaign-audience" label="Target audience">
              <Input
                className={inputClassName}
                id="campaign-audience"
                maxLength={1_000}
                name="audience"
                placeholder="Who should hear about this?"
              />
            </Field>
            <Field htmlFor="campaign-sources" label="Source links (optional)">
              <Textarea
                className={textareaClassName}
                id="campaign-sources"
                name="sourceUrls"
                placeholder="Changelog, pull request, or docs URLs, one per line"
              />
            </Field>
          </Row>
        </Group>
      </Section>

      {error ? (
        <Alert
          className="rounded-xl border-0 bg-red-500/5 ring-1 ring-red-500/20"
          variant="destructive"
        >
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <div className="flex justify-end">
        <Button className="h-10 rounded-lg px-5" disabled={isSaving} type="submit">
          {isSaving ? 'Creating…' : 'Create campaign'}
        </Button>
      </div>
    </form>
  )
}
