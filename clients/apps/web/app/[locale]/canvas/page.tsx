import { headers } from 'next/headers'
import { requirePaidPageAccess } from '@/lib/auth/page-access'
import { hasPermission } from '@/lib/auth/permissions'
import { PlatformShell } from '@/components/platform-shell/PlatformShell'
import { CanvasLibrary } from '@/components/canvas-workspace/CanvasLibrary'

export default async function CanvasPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const access = await requirePaidPageAccess(await headers(), locale, '/canvas')
  return (
    <PlatformShell
      campaignsEnabled={access.campaignWorkflowEnabled}
      organizationName={access.organization?.name}
    >
      <CanvasLibrary
        canEdit={hasPermission(access.role, 'artifact:edit')}
        storySetsEnabled={access.creativeSetsEnabled}
        campaignsEnabled={access.campaignWorkflowEnabled}
      />
    </PlatformShell>
  )
}
