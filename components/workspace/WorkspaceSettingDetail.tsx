import { type ReactNode } from 'react'
import { AccountSettings } from '@/components/settings/AccountSettings'
import { AppearanceSettings } from '@/components/settings/AppearanceSettings'
import { DeveloperTools } from '@/components/settings/DeveloperTools'
import { ExperimentalSettings } from '@/components/settings/ExperimentalSettings'
import { InstallSettings } from '@/components/settings/InstallSettings'
import { IntegrationCatalog } from '@/components/settings/IntegrationCatalog'
import { NewTeamSettings } from '@/components/settings/NewTeamSettings'
import { SocialSetList } from '@/components/settings/social-sets/SocialSetList'
import { SocialSetSettings } from '@/components/settings/social-sets/SocialSetSettings'
import { WebhookSettings } from '@/components/settings/WebhookSettings'
import { ChannelConnections } from './ChannelConnections'
import { WorkspaceAgentSettings } from './WorkspaceAgentSettings'
import { WorkspaceAuditSettings } from './WorkspaceAuditSettings'
import { WorkspaceBilling } from './WorkspaceBilling'
import { WorkspaceBrandSettings } from './WorkspaceBrandSettings'
import { WorkspaceDeveloperSettings } from './WorkspaceDeveloperSettings'
import { WorkspaceGeneralSettings } from './WorkspaceGeneralSettings'
import { WorkspaceIdentitySettings } from './WorkspaceIdentitySettings'
import { WorkspaceIntegrations } from './WorkspaceIntegrations'
import { WorkspaceNotifications } from './WorkspaceNotifications'
import { WorkspaceMembersSettings } from './WorkspaceMembersSettings'
import { WorkspaceIdealCustomerProfile } from './WorkspaceIdealCustomerProfile'
import { WorkspaceProductProfile } from './WorkspaceProductProfile'
import { WorkspaceProductSurfaces } from './WorkspaceProductSurfaces'
import { WorkspaceRolesSettings } from './WorkspaceRolesSettings'
import { WorkspaceSecuritySettings } from './WorkspaceSecuritySettings'
import { WorkspaceSharedLinks } from './WorkspaceSharedLinks'
import { hasPermission } from '@/lib/auth/permissions'
import type { WorkspaceSettingsProps } from './WorkspaceSettings'
import type { SettingId } from './settings-sections'

type WorkspaceSettingContentProps = {
  email: string
  mcpUrl: string
  name: string
  organization: WorkspaceSettingsProps['organization']
  role: string
  socialSet?: WorkspaceSettingsProps['socialSet']
  twoFactorEnabled: boolean
  userId: string
}

function getDetailContent({
  email,
  mcpUrl,
  name,
  organization,
  role,
  socialSet,
  twoFactorEnabled,
  userId,
}: WorkspaceSettingContentProps): Record<SettingId, ReactNode> {
  const canManage = hasPermission(role, 'workspace:update')
  const canPublish = hasPermission(role, 'publish:manage')
  return {
    appearance: <AppearanceSettings />,
    experimental: <ExperimentalSettings canManage={canManage} />,
    install: <InstallSettings />,
    'new-team': <NewTeamSettings email={email} />,
    'social-sets': socialSet ? (
      <SocialSetSettings
        id={socialSet.id}
        key={`${socialSet.id}:${socialSet.page}`}
        page={socialSet.page}
        permissions={{ canManage: canPublish, canWrite: hasPermission(role, 'artifact:edit'), isAdmin: canManage }}
      />
    ) : (
      <SocialSetList canManage={canPublish} />
    ),
    agents: (
      <WorkspaceAgentSettings canManage={hasPermission(role, 'brand:manage')} mcpUrl={mcpUrl} />
    ),
    api: (
      <>
        <WorkspaceDeveloperSettings canManage={canManage} />
        <WebhookSettings canManage={canManage} />
        <DeveloperTools />
      </>
    ),
    audit: (
      <WorkspaceAuditSettings
        canManage={canManage}
        canRead={canManage}
        organizationId={organization.id}
      />
    ),
    billing: <WorkspaceBilling canManage={canManage} />,
    brand: <WorkspaceBrandSettings canManage={canManage} />,
    channels: <ChannelConnections canManage={hasPermission(role, 'publish:manage')} />,
    general: (
      <WorkspaceGeneralSettings
        canDelete={hasPermission(role, 'workspace:delete')}
        canManage={canManage}
        organization={organization}
      />
    ),
    integrations: (
      <>
        <IntegrationCatalog canManage={canManage} />
        <WorkspaceIntegrations canManage={canManage} />
      </>
    ),
    notifications: <WorkspaceNotifications />,
    members: (
      <WorkspaceMembersSettings
        canInvite={hasPermission(role, 'member:invite')}
        canManageMembers={hasPermission(role, 'member:update_role')}
        canRead={hasPermission(role, 'member:read')}
        canTransferOwnership={hasPermission(role, 'workspace:transfer_ownership')}
        currentUserId={userId}
      />
    ),
    product: (
      <>
        <WorkspaceProductProfile canManage={hasPermission(role, 'brand:manage')} />
        <WorkspaceIdealCustomerProfile canManage={hasPermission(role, 'brand:manage')} />
      </>
    ),
    profile: <AccountSettings email={email} name={name} />,
    roles: <WorkspaceRolesSettings />,
    security: <WorkspaceSecuritySettings twoFactorEnabled={twoFactorEnabled} />,
    sharing: <WorkspaceSharedLinks canEdit={hasPermission(role, 'artifact:edit')} />,
    sso: (
      <WorkspaceIdentitySettings
        canManage={canManage}
        isOwner={role === 'owner'}
        organizationId={organization.id}
      />
    ),
    surfaces: <WorkspaceProductSurfaces canManage={hasPermission(role, 'brand:manage')} />,
  }
}

/** The body of one settings section. */
export function WorkspaceSettingContent({
  section,
  ...props
}: WorkspaceSettingContentProps & { section: SettingId }) {
  return getDetailContent(props)[section]
}
