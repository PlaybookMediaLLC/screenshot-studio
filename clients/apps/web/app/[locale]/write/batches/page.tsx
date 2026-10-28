import { PlatformShell } from '@/components/platform-shell/PlatformShell'
import { Page } from '@/components/platform-ui'
import { SidebarLink } from '@/components/platform-shell/SidebarLink'
import { NewBatchButton } from '@/components/write/batch/NewBatchButton'
import { hasPermission } from '@/lib/auth/permissions'
import { listContentBatches } from '@/lib/tenant/content-batches'
import { listSocialSets } from '@/lib/tenant/write'
import { requireDraftsPageAccess } from '../../drafts/page-access'

export const metadata = { title: 'Bulk scheduling' }

/** Open bulk batches, and a way to start one in a publishing brand. */
export default async function BatchesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ set?: string }>
}) {
  const [{ locale }, query] = await Promise.all([params, searchParams])
  const access = await requireDraftsPageAccess(locale, '/write/batches')
  const [{ batches }, sets] = await Promise.all([
    listContentBatches(access.tenant),
    listSocialSets(access.tenant),
  ])
  const canEdit = hasPermission(access.role, 'artifact:edit')
  return (
    <PlatformShell
      campaignsEnabled={access.campaignWorkflowEnabled}
      organizationName={access.organization.name}
    >
      <Page
        title="Bulk scheduling"
        description="Prepare up to 50 separate posts at once from photos, videos or a CSV. Each becomes its own draft; review and scheduling work as they do for one draft. A batch is saved as you go."
      >
        {canEdit ? (
          <NewBatchButton
            sets={sets.map((set) => ({ id: set.id, name: set.name }))}
            defaultSetId={query.set}
          />
        ) : null}
        <ul className="divide-y rounded-xl border">
          {batches.map((batch) => (
            <li key={batch.id} className="flex items-center justify-between p-4 text-sm">
              <SidebarLink className="font-medium underline" href={`/write/batches/${batch.id}`}>
                {batch.title}
              </SidebarLink>
              <span className="text-muted-foreground">
                {batch.itemCount} items ·{' '}
                {sets.find((set) => set.id === batch.socialSetId)?.name ?? 'Publishing brand'}
              </span>
            </li>
          ))}
          {batches.length === 0 ? (
            <li className="p-4 text-sm text-muted-foreground">No open batches.</li>
          ) : null}
        </ul>
      </Page>
    </PlatformShell>
  )
}
