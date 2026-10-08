import type { Metadata } from 'next'
import { CampaignSetupForm } from '@/components/campaigns/CampaignSetupForm'
import { Page } from '@/components/platform-ui'
import { PlatformShell } from '@/components/platform-shell/PlatformShell'
import { hasPermission } from '@/lib/auth/permissions'
import { listProductSurfaces } from '@/lib/tenant/product-surfaces'
import { requireCampaignPageAccess } from '../page-access'

export const metadata: Metadata = { title: 'New campaign | Screenshot Studio' }

type NewCampaignPageProps = {
  params: Promise<{ locale: string }>
}

export default async function NewCampaignPage({ params }: NewCampaignPageProps) {
  const { locale } = await params
  const access = await requireCampaignPageAccess(locale)
  const surfaces = await listProductSurfaces(access.organization.id)

  return (
    <PlatformShell campaignsEnabled organizationName={access.organization.name}>
      <Page
        description="Tell us which product you run and what you just shipped. The campaign draft is saved as soon as you submit."
        title="New campaign"
        width="sm"
      >
        <CampaignSetupForm
          canCreate={hasPermission(access.role, 'release:create')}
          canManageProducts={hasPermission(access.role, 'brand:manage')}
          surfaces={surfaces.map(({ environment, id, name, url }) => ({
            environment,
            id,
            name,
            url,
          }))}
        />
      </Page>
    </PlatformShell>
  )
}
