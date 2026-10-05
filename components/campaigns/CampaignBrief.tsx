'use client'

import { useRouter } from 'next/navigation'
import { type FormEvent, useEffect, useState } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { getErrorMessage } from '@/components/workspace/settings-client'
import { trackEvent } from '@/lib/analytics'
import { useTRPCClient } from '@/lib/trpc/react'

type CampaignStatus = 'APPROVED' | 'ARCHIVED' | 'DRAFT' | 'READY_FOR_REVIEW'

type CampaignBriefProps = {
  campaign: { id: string; postCount: number; status: CampaignStatus }
  canApprove: boolean
  canEdit: boolean
  productSurface: { environment: string; id: string; name: string; url: string } | null
  release: {
    audience: string | null
    benefitStatement: string
    description: string | null
    id: string
    sourceUrls: string[]
    title: string
  } | null
}

type StatusAction = { label: string; to: CampaignStatus; variant?: 'outline' }

/** Mirrors campaignStatusTransitions; the server re-checks every move. */
function getStatusActions(
  status: CampaignStatus,
  { canApprove, canEdit }: { canApprove: boolean; canEdit: boolean }
): StatusAction[] {
  const edit = (action: StatusAction) => (canEdit ? [action] : [])
  const archive = edit({ label: 'Archive', to: 'ARCHIVED', variant: 'outline' })
  switch (status) {
    case 'DRAFT':
      return [...edit({ label: 'Submit for review', to: 'READY_FOR_REVIEW' }), ...archive]
    case 'READY_FOR_REVIEW':
      return [
        ...(canApprove ? [{ label: 'Approve', to: 'APPROVED' as const }] : []),
        ...edit({ label: 'Back to draft', to: 'DRAFT', variant: 'outline' }),
        ...archive,
      ]
    case 'APPROVED':
      return [...edit({ label: 'Reopen as draft', to: 'DRAFT', variant: 'outline' }), ...archive]
    case 'ARCHIVED':
      return edit({ label: 'Restore as draft', to: 'DRAFT', variant: 'outline' })
  }
}

function field(data: FormData, name: string): string {
  return String(data.get(name) ?? '').trim()
}

export function CampaignBrief({
  campaign,
  canApprove,
  canEdit,
  productSurface,
  release,
}: CampaignBriefProps) {
  const router = useRouter()
  const trpcClient = useTRPCClient()
  const [isEditing, setIsEditing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const statusActions = getStatusActions(campaign.status, { canApprove, canEdit })

  useEffect(() => {
    trackEvent('campaign_opened', { campaignId: campaign.id })
  }, [campaign.id])

  async function handleSave(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (!release) return
    const data = new FormData(event.currentTarget)
    setError(null)
    setMessage(null)
    setIsSaving(true)
    try {
      await trpcClient.release.update.mutate({
        audience: field(data, 'audience') || null,
        benefitStatement: field(data, 'benefitStatement'),
        description: field(data, 'description') || null,
        releaseId: release.id,
        sourceUrls: field(data, 'sourceUrls').split(/\s+/).filter(Boolean),
        title: field(data, 'title'),
      })
      setIsEditing(false)
      setMessage('Brief updated.')
      router.refresh()
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setIsSaving(false)
    }
  }

  async function handleTransition(to: CampaignStatus): Promise<void> {
    setError(null)
    setMessage(null)
    setIsSaving(true)
    try {
      await trpcClient.campaign.transition.mutate({ campaignId: campaign.id, status: to })
      router.refresh()
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <section aria-labelledby="campaign-brief" className="rounded-lg border p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 className="text-base font-semibold" id="campaign-brief">
          Release brief
        </h2>
        {canEdit && release && !isEditing ? (
          <Button onClick={() => setIsEditing(true)} size="sm" type="button" variant="outline">
            Edit brief
          </Button>
        ) : null}
      </div>

      {productSurface ? (
        <p className="mt-2 text-sm text-muted-foreground">
          {productSurface.name} · {productSurface.environment} ·{' '}
          <a className="underline" href={productSurface.url} rel="noreferrer" target="_blank">
            {productSurface.url}
          </a>
        </p>
      ) : null}

      {!release ? (
        <p className="mt-4 text-sm text-muted-foreground">No release is linked to this campaign.</p>
      ) : isEditing ? (
        <form className="mt-4 grid gap-4" onSubmit={handleSave}>
          <Label className="grid gap-1.5" htmlFor="brief-title">
            Release title
            <Input
              defaultValue={release.title}
              id="brief-title"
              maxLength={160}
              name="title"
              required
            />
          </Label>
          <Label className="grid gap-1.5" htmlFor="brief-benefit">
            Why it matters
            <Input
              defaultValue={release.benefitStatement}
              id="brief-benefit"
              maxLength={500}
              name="benefitStatement"
              required
            />
          </Label>
          <Label className="grid gap-1.5" htmlFor="brief-description">
            Description
            <Textarea
              defaultValue={release.description ?? ''}
              id="brief-description"
              maxLength={10_000}
              name="description"
            />
          </Label>
          <Label className="grid gap-1.5" htmlFor="brief-audience">
            Target audience
            <Input
              defaultValue={release.audience ?? ''}
              id="brief-audience"
              maxLength={1_000}
              name="audience"
            />
          </Label>
          <Label className="grid gap-1.5" htmlFor="brief-sources">
            Source links
            <Textarea
              defaultValue={release.sourceUrls.join('\n')}
              id="brief-sources"
              name="sourceUrls"
            />
          </Label>
          <div className="flex gap-2">
            <Button disabled={isSaving} type="submit">
              {isSaving ? 'Saving…' : 'Save brief'}
            </Button>
            <Button onClick={() => setIsEditing(false)} type="button" variant="ghost">
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <dl className="mt-4 grid gap-4 text-sm">
          <div>
            <dt className="text-xs font-medium uppercase text-muted-foreground">Release</dt>
            <dd className="mt-1 font-medium">{release.title}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase text-muted-foreground">Why it matters</dt>
            <dd className="mt-1">{release.benefitStatement}</dd>
          </div>
          {release.description ? (
            <div>
              <dt className="text-xs font-medium uppercase text-muted-foreground">Description</dt>
              <dd className="mt-1 whitespace-pre-wrap">{release.description}</dd>
            </div>
          ) : null}
          {release.audience ? (
            <div>
              <dt className="text-xs font-medium uppercase text-muted-foreground">Audience</dt>
              <dd className="mt-1">{release.audience}</dd>
            </div>
          ) : null}
          {release.sourceUrls.length > 0 ? (
            <div>
              <dt className="text-xs font-medium uppercase text-muted-foreground">Sources</dt>
              <dd className="mt-1 grid gap-1">
                {release.sourceUrls.map((url) => (
                  <a
                    className="truncate underline"
                    href={url}
                    key={url}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {url}
                  </a>
                ))}
              </dd>
            </div>
          ) : null}
        </dl>
      )}

      {error ? (
        <Alert className="mt-4" variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {message ? (
        <Alert className="mt-4">
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      ) : null}

      {statusActions.length > 0 ? (
        <div className="mt-6 flex flex-wrap items-center gap-2 border-t pt-4">
          {statusActions.map((action) => (
            <Button
              disabled={isSaving || (action.to === 'READY_FOR_REVIEW' && campaign.postCount === 0)}
              key={action.to}
              onClick={() => handleTransition(action.to)}
              size="sm"
              type="button"
              variant={action.variant}
            >
              {action.label}
            </Button>
          ))}
          {campaign.status === 'DRAFT' && campaign.postCount === 0 ? (
            <span className="text-xs text-muted-foreground">
              Review opens once the campaign has copy.
            </span>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
