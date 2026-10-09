'use client'

import { useRouter } from 'next/navigation'
import { type FormEvent, type ReactNode, useEffect, useState } from 'react'
import { Group, Row, Section } from '@/components/platform-ui'
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

const inputClassName = 'h-10 rounded-lg'
const textareaClassName = 'min-h-24 rounded-lg'

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

/** A read-only key/value row: muted label on the left, value on the right. */
function DetailRow({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="flex flex-col gap-1 px-5 py-4 md:flex-row md:gap-6">
      <dt className="text-sm text-neutral-500 md:w-40 md:shrink-0">{label}</dt>
      <dd className="min-w-0 text-sm text-white">{children}</dd>
    </div>
  )
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
    <>
      <Section
        actions={
          canEdit && release && !isEditing ? (
            <Button
              className="rounded-lg"
              onClick={() => setIsEditing(true)}
              size="sm"
              type="button"
              variant="outline"
            >
              Edit brief
            </Button>
          ) : null
        }
        id="campaign-brief"
        title="Release brief"
      >
        {!release ? (
          <Group>
            <Row>
              <p className="text-sm text-neutral-500">No release is linked to this campaign.</p>
            </Row>
          </Group>
        ) : isEditing ? (
          <form onSubmit={handleSave}>
            <Group>
              <Row>
                <Field htmlFor="brief-title" label="Release title">
                  <Input
                    className={inputClassName}
                    defaultValue={release.title}
                    id="brief-title"
                    maxLength={160}
                    name="title"
                    required
                  />
                </Field>
                <Field htmlFor="brief-benefit" label="Why it matters">
                  <Input
                    aria-describedby="brief-benefit-hint"
                    className={inputClassName}
                    defaultValue={release.benefitStatement}
                    id="brief-benefit"
                    maxLength={500}
                    name="benefitStatement"
                  />
                  <p className="text-xs text-neutral-500" id="brief-benefit-hint">
                    Can be left empty while the release has a source link; the spec drafts it.
                  </p>
                </Field>
                <Field htmlFor="brief-description" label="Description">
                  <Textarea
                    className={textareaClassName}
                    defaultValue={release.description ?? ''}
                    id="brief-description"
                    maxLength={10_000}
                    name="description"
                  />
                </Field>
                <Field htmlFor="brief-audience" label="Target audience">
                  <Input
                    className={inputClassName}
                    defaultValue={release.audience ?? ''}
                    id="brief-audience"
                    maxLength={1_000}
                    name="audience"
                  />
                </Field>
                <Field htmlFor="brief-sources" label="Source links">
                  <Textarea
                    className={textareaClassName}
                    defaultValue={release.sourceUrls.join('\n')}
                    id="brief-sources"
                    name="sourceUrls"
                  />
                </Field>
              </Row>
              <Row>
                <div className="flex justify-end gap-2">
                  <Button
                    className="rounded-lg"
                    onClick={() => setIsEditing(false)}
                    type="button"
                    variant="ghost"
                  >
                    Cancel
                  </Button>
                  <Button className="rounded-lg" disabled={isSaving} type="submit">
                    {isSaving ? 'Saving…' : 'Save brief'}
                  </Button>
                </div>
              </Row>
            </Group>
          </form>
        ) : (
          <Group>
            <dl className="divide-y divide-white/[0.07]">
              <DetailRow label="Release">{release.title}</DetailRow>
              <DetailRow label="Why it matters">
                {release.benefitStatement || (
                  <span className="text-neutral-500">
                    Not set; the spec drafts it from the sources.
                  </span>
                )}
              </DetailRow>
              {release.description ? (
                <DetailRow label="Description">
                  <span className="whitespace-pre-wrap">{release.description}</span>
                </DetailRow>
              ) : null}
              {release.audience ? <DetailRow label="Audience">{release.audience}</DetailRow> : null}
              {release.sourceUrls.length > 0 ? (
                <DetailRow label="Sources">
                  <span className="grid gap-1">
                    {release.sourceUrls.map((url) => (
                      <a
                        className="truncate hover:underline"
                        href={url}
                        key={url}
                        rel="noreferrer"
                        target="_blank"
                      >
                        {url}
                      </a>
                    ))}
                  </span>
                </DetailRow>
              ) : null}
            </dl>
          </Group>
        )}

        {error ? (
          <Alert
            className="rounded-xl border-0 bg-red-500/5 ring-1 ring-red-500/20"
            variant="destructive"
          >
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {message ? (
          <Alert className="rounded-xl border-0 bg-white/[0.02] ring-1 ring-white/[0.08]">
            <AlertDescription>{message}</AlertDescription>
          </Alert>
        ) : null}
      </Section>

      {productSurface ? (
        <Section title="Product">
          <Group>
            <dl>
              <DetailRow label="Product surface">
                {productSurface.name} · {productSurface.environment} ·{' '}
                <a
                  className="text-neutral-400 hover:underline"
                  href={productSurface.url}
                  rel="noreferrer"
                  target="_blank"
                >
                  {productSurface.url}
                </a>
              </DetailRow>
            </dl>
          </Group>
        </Section>
      ) : null}

      {statusActions.length > 0 ? (
        <Section title="Review">
          <Group>
            <Row
              description={
                campaign.status === 'DRAFT' && campaign.postCount === 0
                  ? 'Review opens once the campaign has copy.'
                  : 'Move the campaign through review.'
              }
              label="Status"
            >
              <div className="flex flex-wrap gap-2 md:justify-end">
                {statusActions.map((action) => (
                  <Button
                    className="rounded-lg"
                    disabled={
                      isSaving || (action.to === 'READY_FOR_REVIEW' && campaign.postCount === 0)
                    }
                    key={action.to}
                    onClick={() => handleTransition(action.to)}
                    size="sm"
                    type="button"
                    variant={action.variant}
                  >
                    {action.label}
                  </Button>
                ))}
              </div>
            </Row>
          </Group>
        </Section>
      ) : null}
    </>
  )
}
