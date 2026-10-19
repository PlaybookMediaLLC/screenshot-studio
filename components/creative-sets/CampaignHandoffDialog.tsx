'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import type { CreativeSetSession } from '@/lib/creative-sets/session'
import { creativeSetHandoffSchema } from '@/lib/creative-sets/schema'

export function CampaignHandoffDialog({
  session,
  onClose,
}: {
  session: CreativeSetSession
  onClose: () => void
}) {
  const [campaigns, setCampaigns] = useState<Array<{ id: string; name: string }>>([])
  const [campaignId, setCampaignId] = useState(''),
    [deliveryId, setDeliveryId] = useState(''),
    [channel, setChannel] = useState('linkedin'),
    [copy, setCopy] = useState('')
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null)
  const [attached, setAttached] = useState<{
    campaignId: string
    designId: string
    postId: string
  } | null>(null)
  const delivered = session.snapshot().document.deliveries.filter((delivery) => delivery.asset)
  useEffect(() => {
    let active = true
    void session.client.campaign.list
      .query()
      .then(({ campaigns }) => {
        if (active) setCampaigns(campaigns)
      })
      .catch((error) => {
        if (active) setError(error.message)
      })
    return () => {
      active = false
    }
  }, [session])
  async function attach() {
    setBusy(true)
    setError(null)
    try {
      if (!(await session.save())) throw new Error('Save this set before attaching a delivery.')
      const input = creativeSetHandoffSchema.parse({
        creativeSetId: session.record.id,
        baseRevision: session.snapshot().revision,
        campaignId,
        deliveryId,
        channel,
        copy,
      })
      setAttached(await session.client.creativeSet.attachCampaign.mutate(input))
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Campaign attachment failed.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-auto sm:max-w-xl">
        <DialogTitle>Attach delivered creative</DialogTitle>
        <DialogDescription>
          Send one saved file and draft post to an existing campaign. Campaign approval and
          scheduling control automatic publication; future set edits create a new candidate.
        </DialogDescription>
        {attached ? (
          <div className="space-y-3">
            <p role="status">
              The delivered revision is attached for review. Existing approved and scheduled files
              retain their original bytes.
            </p>
            <Button asChild>
              <Link href={`/campaigns/${attached.campaignId}`}>
                Review and schedule publication
              </Link>
            </Button>
          </div>
        ) : (
          <>
            <label className="grid gap-1 text-sm">
              Campaign
              <select
                value={campaignId}
                onChange={(event) => setCampaignId(event.target.value)}
                className="rounded border bg-background p-2"
              >
                <option value="">Choose campaign…</option>
                {campaigns.map((campaign) => (
                  <option key={campaign.id} value={campaign.id}>
                    {campaign.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              Immutable delivered file
              <select
                value={deliveryId}
                onChange={(event) => setDeliveryId(event.target.value)}
                className="rounded border bg-background p-2"
              >
                <option value="">Choose a saved delivery…</option>
                {delivered.map((delivery) => (
                  <option key={delivery.id} value={delivery.id}>
                    {delivery.fileName} · r{delivery.revision}
                  </option>
                ))}
              </select>
            </label>
            {!delivered.length ? (
              <p className="text-sm">Export a format and save it to workspace assets first.</p>
            ) : null}
            <label className="grid gap-1 text-sm">
              Post channel
              <select
                value={channel}
                onChange={(event) => setChannel(event.target.value)}
                className="rounded border bg-background p-2"
              >
                <option value="linkedin">LinkedIn</option>
                <option value="x">X</option>
                <option value="instagram">Instagram</option>
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              Draft post
              <Textarea
                value={copy}
                maxLength={channel === 'x' ? 280 : channel === 'instagram' ? 2200 : 3000}
                onChange={(event) => setCopy(event.target.value)}
              />
            </label>
            <Button
              disabled={busy || !campaignId || !deliveryId || !copy.trim()}
              onClick={() => void attach()}
            >
              Attach for campaign review
            </Button>
          </>
        )}
        {error ? (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
