import { type ReactNode } from 'react'
import { ProfileForm } from '@/components/auth/ProfileForm'
import { Button } from '@/components/ui/button'
import { WorkspaceAuditSettings } from './WorkspaceAuditSettings'
import { WorkspaceBrandSettings } from './WorkspaceBrandSettings'
import { WorkspaceDeveloperSettings } from './WorkspaceDeveloperSettings'
import { WorkspaceGeneralSettings } from './WorkspaceGeneralSettings'
import { WorkspaceIdentitySettings } from './WorkspaceIdentitySettings'
import { WorkspaceMembersSettings } from './WorkspaceMembersSettings'
import { WorkspaceRolesSettings } from './WorkspaceRolesSettings'
import { WorkspaceSecuritySettings } from './WorkspaceSecuritySettings'
import type { SettingId, SettingItem, WorkspaceSettingsProps } from './WorkspaceSettings'

type WorkspaceSettingDetailProps = {
  email: string
  item: SettingItem
  name: string
  onBack: () => void
  organization: WorkspaceSettingsProps['organization']
  role: string
  twoFactorEnabled: boolean
}

function getDetailContent({
  email,
  name,
  organization,
  role,
  twoFactorEnabled,
}: Omit<WorkspaceSettingDetailProps, 'item' | 'onBack'>): Record<SettingId, ReactNode> {
  const canManage = role === 'admin' || role === 'owner'
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
    general: <WorkspaceGeneralSettings canManage={canManage} organization={organization} />,
    members: <WorkspaceMembersSettings canManage={canManage} organizationId={organization.id} />,
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

export function WorkspaceSettingDetail({
  email,
  item,
  name,
  onBack,
  organization,
  role,
  twoFactorEnabled,
}: WorkspaceSettingDetailProps) {
  const Icon = item.icon
  const content = getDetailContent({ email, name, organization, role, twoFactorEnabled })

  return (
    <section className="w-full">
      <Button
        className="text-sm font-medium text-muted-foreground hover:text-foreground"
        onClick={onBack}
        type="button"
        variant="ghost"
      >
        All settings
      </Button>
      <div className="mt-6 rounded-lg border border-foreground/10 bg-card p-6 sm:p-8">
        <span className="flex h-11 w-11 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <Icon size={22} />
        </span>
        <h2 className="mt-5 text-xl font-semibold">{item.title}</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.description}</p>
        <div className="mt-8 border-t pt-6">{content[item.id]}</div>
      </div>
    </section>
  )
}
