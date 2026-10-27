import { getRolePermissions, hasPermission, organizationRoles } from '@/lib/auth/permissions'
import { roleCapabilities, roleLabels, roleSummaries } from '@/lib/auth/role-descriptions'

export function WorkspaceRolesSettings() {
  return (
    <div className="grid gap-6">
      <p className="text-sm text-muted-foreground">
        Choose the smallest role that covers a teammate’s work. Change roles in Members.
      </p>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Workspace role capabilities</caption>
          <thead>
            <tr>
              <th
                className="p-4 align-bottom text-xs font-medium text-muted-foreground"
                scope="col"
              >
                Role
              </th>
              {roleCapabilities.map(({ label }) => (
                <th
                  className="p-4 align-bottom text-xs font-medium text-muted-foreground"
                  scope="col"
                  key={label}
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {organizationRoles.map((role) => (
              <tr className="border-t border-border" key={role}>
                <th className="min-w-56 max-w-72 p-4 font-normal" scope="row">
                  <span className="font-medium capitalize">{roleLabels[role]}</span>
                  <p className="mt-1 text-xs text-muted-foreground">{roleSummaries[role]}</p>
                </th>
                {roleCapabilities.map(({ permission }) => (
                  <td className="p-4" key={permission}>
                    {hasPermission(role, permission) ? 'Yes' : '—'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <details className="text-sm text-muted-foreground">
        <summary className="cursor-pointer">Technical permission details</summary>
        {organizationRoles.map((role) => (
          <p className="mt-3" key={role}>
            <strong className="capitalize">{roleLabels[role]}: </strong>
            {getRolePermissions(role).join(', ')}
          </p>
        ))}
      </details>
    </div>
  )
}
