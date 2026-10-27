import { ReturnToWork } from '@/components/platform-hub/ReturnToWork'
import { Page, Section } from '@/components/platform-ui'
import { SettingsNav } from '@/components/settings/SettingsNav'
import { WorkspaceDeletionRecovery } from './WorkspaceDeletionSettings'
import { WorkspaceSettingContent } from './WorkspaceSettingDetail'
import { SETTINGS_SECTIONS, type SettingId, type SocialSetPage } from './settings-sections'

export type WorkspaceSettingsProps = {
  email: string
  /** The public MCP server URL, shown under AI agents. */
  mcpUrl: string
  name: string
  organization: {
    id: string
    logo: string | null
    name: string
    slug: string
    workspaceDeletion?: { requestedByUserId: string; scheduledFor: Date; status: string } | null
    workspaceSettings?: {
      aiAgentEnabled: boolean
      defaultPublishTime: string
      description: string | null
      locale: string
      timeZone: string
    } | null
  }
  role: string
  section: SettingId
  /** The social set and page, for a social set's own settings. */
  socialSet?: { id: string; page: SocialSetPage }
  twoFactorEnabled: boolean
  userId: string
}

/**
 * One settings section beside the grouped settings navigation. Each section
 * is its own route, linked from the sidebar under Settings and from the list
 * here, so the address always says where you are.
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
    <Page title="Settings" tagline="Your account, workspace and publishing.">
      <ReturnToWork />
      <div className="flex flex-col gap-6 lg:flex-row lg:gap-10">
        <SettingsNav />
        <div className="min-w-0 max-w-[880px] flex-1">
          <Section description={current.description} title={current.title}>
            <WorkspaceSettingContent section={section} {...props} />
          </Section>
        </div>
      </div>
    </Page>
  )
}
