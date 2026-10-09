import { Page, Section } from '@/components/platform-ui'
import { WorkspaceDeletionRecovery } from './WorkspaceDeletionSettings'
import { WorkspaceSettingContent } from './WorkspaceSettingDetail'
import { SETTINGS_SECTIONS, type SettingId } from './settings-sections'

export type WorkspaceSettingsProps = {
  email: string
  name: string
  organization: {
    id: string
    logo: string | null
    name: string
    slug: string
    workspaceDeletion?: { requestedByUserId: string; scheduledFor: Date; status: string } | null
    workspaceSettings?: {
      defaultPublishTime: string
      description: string | null
      locale: string
      timeZone: string
    } | null
  }
  role: string
  section: SettingId
  twoFactorEnabled: boolean
  userId: string
}

/**
 * One workspace settings section. Each section is its own route, linked from
 * the sidebar under Settings, so the page is just the section's content.
 */
export function WorkspaceSettings({ section, ...props }: WorkspaceSettingsProps) {
  const { organization, userId } = props
  if (
    organization.workspaceDeletion?.status === 'PENDING' ||
    organization.workspaceDeletion?.status === 'PROCESSING'
  ) {
    return (
      <main className="text-foreground">
        <WorkspaceDeletionRecovery
          canRestore={organization.workspaceDeletion.requestedByUserId === userId}
          scheduledFor={organization.workspaceDeletion.scheduledFor}
        />
      </main>
    )
  }

  const current = SETTINGS_SECTIONS.find((item) => item.id === section) ?? SETTINGS_SECTIONS[0]!
  return (
    <Page title="Settings" width="md">
      <Section description={current.description} title={current.title}>
        <WorkspaceSettingContent section={section} {...props} />
      </Section>
    </Page>
  )
}
