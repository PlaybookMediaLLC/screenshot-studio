import { type ReactNode } from 'react'
import { ProfileForm } from '@/components/auth/ProfileForm'
import { WorkspaceAuditSettings } from './WorkspaceAuditSettings'
import { WorkspaceBrandSettings } from './WorkspaceBrandSettings'
import { WorkspaceDeveloperSettings } from './WorkspaceDeveloperSettings'
import { WorkspaceGeneralSettings } from './WorkspaceGeneralSettings'
import { WorkspaceIdentitySettings } from './WorkspaceIdentitySettings'
import { WorkspaceMembersSettings } from './WorkspaceMembersSettings'
import { WorkspaceRolesSettings } from './WorkspaceRolesSettings'
import { WorkspaceSecuritySettings } from './WorkspaceSecuritySettings'
import { hasPermission } from '@/lib/auth/permissions'
import type { WorkspaceSettingsProps } from './WorkspaceSettings'
import type { SettingId } from './settings-sections'

type WorkspaceSettingContentProps = {
  email: string
  name: string
  organization: WorkspaceSettingsProps['organization']
  role: string
  twoFactorEnabled: boolean
  userId: string
}

function getDetailContent({
  email,
  name,
  organization,
  role,
  twoFactorEnabled,
  userId,
}: WorkspaceSettingContentProps): Record<SettingId, ReactNode> {
  const canManage = hasPermission(role, 'workspace:update')
  return {
    api: <WorkspaceDeveloperSettings canManage={canManage} />,
    audit: (
      <WorkspaceAuditSettings
        canManage={canManage}
        canRead={canManage}
        organizationId={organization.id}
      />
    ),
    brand: <WorkspaceBrandSettings canManage={canManage} />,
    general: (
      <WorkspaceGeneralSettings
        canDelete={hasPermission(role, 'workspace:delete')}
        canManage={canManage}
        organization={organization}
      />
    ),
    members: (
      <WorkspaceMembersSettings
        canInvite={hasPermission(role, 'member:invite')}
        canManageMembers={hasPermission(role, 'member:update_role')}
        canRead={hasPermission(role, 'member:read')}
        canTransferOwnership={hasPermission(role, 'workspace:transfer_ownership')}
        currentUserId={userId}
      />
    ),
    profile: <ProfileForm email={email} name={name} />,
    roles: <WorkspaceRolesSettings />,
    security: <WorkspaceSecuritySettings twoFactorEnabled={twoFactorEnabled} />,
    sso: (
      <WorkspaceIdentitySettings
        canManage={canManage}
        isOwner={role === 'owner'}
        organizationId={organization.id}
      />
    ),
  }
}

/** The body of one settings section. */
export function WorkspaceSettingContent({
  section,
  ...props
}: WorkspaceSettingContentProps & { section: SettingId }) {
  return getDetailContent(props)[section]
}
