import type { Metadata } from 'next'
import { CampaignSetupForm } from '@/components/campaigns/CampaignSetupForm'
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
      <main className="mx-auto max-w-2xl px-6 py-10">
        <header className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight">New campaign</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Tell us which product you run and what you just shipped. The campaign draft is saved as
            soon as you submit.
          </p>
        </header>
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
      </main>
    </PlatformShell>
  )
}
