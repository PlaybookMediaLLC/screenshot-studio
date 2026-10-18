import { type ReactNode } from 'react'
import { ProfileForm } from '@/components/auth/ProfileForm'
import { ChannelConnections } from './ChannelConnections'
import { WorkspaceAgentSettings } from './WorkspaceAgentSettings'
import { WorkspaceAuditSettings } from './WorkspaceAuditSettings'
import { WorkspaceBilling } from './WorkspaceBilling'
import { WorkspaceBrandSettings } from './WorkspaceBrandSettings'
import { WorkspaceDeveloperSettings } from './WorkspaceDeveloperSettings'
import { WorkspaceGeneralSettings } from './WorkspaceGeneralSettings'
import { WorkspaceIdentitySettings } from './WorkspaceIdentitySettings'
import { WorkspaceIntegrations } from './WorkspaceIntegrations'
import { WorkspaceMembersSettings } from './WorkspaceMembersSettings'
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
  twoFactorEnabled: boolean
  userId: string
}

function getDetailContent({
  email,
  mcpUrl,
  name,
  organization,
  role,
  twoFactorEnabled,
  userId,
}: WorkspaceSettingContentProps): Record<SettingId, ReactNode> {
  const canManage = hasPermission(role, 'workspace:update')
  return {
    agents: <WorkspaceAgentSettings canManage={hasPermission(role, 'brand:manage')} mcpUrl={mcpUrl} />,
    api: <WorkspaceDeveloperSettings canManage={canManage} />,
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
    integrations: <WorkspaceIntegrations canManage={canManage} />,
    members: (
      <WorkspaceMembersSettings
        canInvite={hasPermission(role, 'member:invite')}
        canManageMembers={hasPermission(role, 'member:update_role')}
        canRead={hasPermission(role, 'member:read')}
        canTransferOwnership={hasPermission(role, 'workspace:transfer_ownership')}
        currentUserId={userId}
      />
    ),
    product: <WorkspaceProductProfile canManage={hasPermission(role, 'brand:manage')} />,
    profile: <ProfileForm email={email} name={name} />,
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
