import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { WorkspaceSettings } from '@/components/workspace/WorkspaceSettings'
import { getLocalizedPath, getPageAccess } from '@/lib/auth/page-access'

type WorkspacePageProps = {
  params: Promise<{ locale: string }>
}

export default async function WorkspacePage({ params }: WorkspacePageProps) {
  const [{ locale }, requestHeaders] = await Promise.all([params, headers()])
  const access = await getPageAccess(requestHeaders)
  if (!access) redirect(getLocalizedPath(locale, '/sign-in'))
  if (!access.hasOrganization) redirect(getLocalizedPath(locale, '/onboarding'))

  return (
    <WorkspaceSettings
      email={access.session.user.email}
      name={access.session.user.name || ''}
      organizationName={access.organization?.name ?? 'Workspace'}
    />
  )
}
