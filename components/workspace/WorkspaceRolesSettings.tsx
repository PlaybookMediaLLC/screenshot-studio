import { organizationRoles, permissions } from '@/lib/auth/permissions'

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
    <div className="grid max-w-3xl gap-6">
      <p className="text-sm text-muted-foreground">
        Roles are fixed policy definitions. Assign a role to a member from the Members section.
      </p>
      <ul className="overflow-hidden rounded-md border border-foreground/10">
        {organizationRoles.map((role) => (
          <li className="border-b border-foreground/10 px-4 py-3 last:border-b-0" key={role}>
            <p className="text-sm font-semibold capitalize">{role}</p>
            <p className="mt-1 text-sm text-muted-foreground">{roleSummaries[role]}</p>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        Defined permissions: {permissions.join(', ')}.
      </p>
    </div>
  )
}
