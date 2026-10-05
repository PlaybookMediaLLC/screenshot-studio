'use client'

import { useRouter } from 'next/navigation'
import { type FormEvent, useRef, useState } from 'react'
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

const selectClassName =
  'h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs disabled:opacity-50'

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
        objective: benefitStatement,
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
      <p className="text-sm text-muted-foreground">
        Your role cannot create campaigns. Ask a workspace admin for creator access.
      </p>
    )
  }

  return (
    <form className="grid gap-8" onSubmit={handleSubmit}>
      <fieldset className="grid gap-4">
        <legend className="mb-2 text-base font-semibold">Product</legend>
        <Label className="grid gap-1.5" htmlFor="campaign-product">
          Product
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
        </Label>
        {isNewProduct ? (
          <>
            <Label className="grid gap-1.5" htmlFor="campaign-product-name">
              Product name
              <Input id="campaign-product-name" maxLength={160} name="productName" required />
            </Label>
            <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
              <Label className="grid gap-1.5" htmlFor="campaign-app-url">
                App URL
                <Input
                  id="campaign-app-url"
                  name="appUrl"
                  placeholder="https://app.example.com"
                  required
                  type="url"
                />
              </Label>
              <Label className="grid gap-1.5" htmlFor="campaign-environment">
                Environment
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
              </Label>
            </div>
            <Label className="grid gap-1.5" htmlFor="campaign-marketing-url">
              Marketing site URL (optional)
              <Input
                id="campaign-marketing-url"
                name="marketingUrl"
                placeholder="https://example.com"
                type="url"
              />
            </Label>
          </>
        ) : null}
      </fieldset>

      <fieldset className="grid gap-4">
        <legend className="mb-2 text-base font-semibold">What did you ship?</legend>
        <Label className="grid gap-1.5" htmlFor="campaign-release-title">
          Release title
          <Input id="campaign-release-title" maxLength={160} name="title" required />
        </Label>
        <Label className="grid gap-1.5" htmlFor="campaign-benefit">
          Why it matters
          <Input
            id="campaign-benefit"
            maxLength={500}
            name="benefitStatement"
            placeholder="One sentence on what this changes for your users"
            required
          />
        </Label>
        <Label className="grid gap-1.5" htmlFor="campaign-description">
          Description
          <Textarea
            id="campaign-description"
            maxLength={10_000}
            name="description"
            placeholder="What changed, in your own words. Plain text."
          />
        </Label>
        <Label className="grid gap-1.5" htmlFor="campaign-audience">
          Target audience
          <Input
            id="campaign-audience"
            maxLength={1_000}
            name="audience"
            placeholder="Who should hear about this?"
          />
        </Label>
        <Label className="grid gap-1.5" htmlFor="campaign-sources">
          Source links (optional)
          <Textarea
            id="campaign-sources"
            name="sourceUrls"
            placeholder="Changelog, pull request, or docs URLs, one per line"
          />
        </Label>
      </fieldset>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <Button className="w-fit" disabled={isSaving} type="submit">
        {isSaving ? 'Creating…' : 'Create campaign'}
      </Button>
    </form>
  )
}
