import { Group, Pill, Row } from '@/components/platform-ui'
import { getRolePermissions, organizationRoles, permissions } from '@/lib/auth/permissions'

const roleSummaries: Record<(typeof organizationRoles)[number], string> = {
  admin: 'Manage the workspace, members, identity, brand, publishing, and audit controls.',
  approver: 'Review and approve artifacts before they are published.',
  creator: 'Create releases and edit content artifacts.',
  owner: 'Full workspace access, including ownership and enterprise controls.',
  publisher: 'Manage connected publishing providers and scheduled posts.',
  viewer: 'Read approved artifacts without changing workspace data.',
}

export function WorkspaceRolesSettings() {
  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-neutral-500">
        Roles are fixed policy definitions. Assign a role to a member from the Members section.
      </p>
      <Group>
        {organizationRoles.map((role) => (
          <Row
            description={roleSummaries[role]}
            key={role}
            label={<span className="capitalize">{role}</span>}
            layout="inline"
          >
            <Pill tone={role === 'owner' ? 'purple' : 'gray'}>
              {getRolePermissions(role).length} permissions
            </Pill>
          </Row>
        ))}
      </Group>
      <Group>
        <Row
          description="Every permission a role can grant."
          label="Defined permissions"
          layout="stacked"
        >
          <div className="flex flex-wrap gap-1.5">
            {permissions.map((permission) => (
              <span
                className="rounded-md bg-white/[0.04] px-2 py-0.5 font-mono text-xs text-neutral-400 ring-1 ring-white/[0.06]"
                key={permission}
              >
                {permission}
              </span>
            ))}
          </div>
        </Row>
      </Group>
    </div>
  )
}
