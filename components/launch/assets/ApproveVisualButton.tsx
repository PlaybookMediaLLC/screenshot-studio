'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { getErrorMessage } from '@/components/workspace/settings-client'
import { useTRPCClient } from '@/lib/trpc/react'

/** Approves a design's current render as the visual its posts publish with. */
export function ApproveVisualButton({
  campaignId,
  designId,
  assetId,
  label = 'Approve visual',
}: {
  campaignId: string
  designId?: string
  assetId?: string
  label?: string
}) {
  const trpcClient = useTRPCClient()
  const router = useRouter()
  const [pending, setPending] = useState(false)

  async function approve() {
    setPending(true)
    try {
      if (designId) await trpcClient.campaign.approveDesign.mutate({ campaignId, designId })
      else if (assetId) await trpcClient.campaign.approveAsset.mutate({ campaignId, assetId })
      else throw new Error('This visual has no render to approve.')
      toast.success('Visual approved')
      router.refresh()
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setPending(false)
    }
  }

  return (
    <Button
      className="h-8 rounded-lg text-xs"
      disabled={pending}
      onClick={() => void approve()}
      size="sm"
      type="button"
    >
      {pending ? 'Approving…' : label}
    </Button>
  )
}
