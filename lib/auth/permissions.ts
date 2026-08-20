import { defaultAc, defaultRoles } from 'better-auth/plugins/organization/access'

export const organizationRoles = [
  'owner',
  'admin',
  'creator',
  'approver',
  'publisher',
  'viewer',
] as const

export type OrganizationRole = (typeof organizationRoles)[number]

export const permissions = [
  'workspace:read',
  'workspace:update',
  'workspace:delete',
  'workspace:transfer_ownership',
  'member:read',
  'member:invite',
  'member:remove',
  'member:update_role',
  'invitation:read',
  'invitation:revoke',
  'audit:read',
  'audit:export',
  'audit:manage',
  'identity:manage',
  'brand:manage',
  'release:create',
  'release:approve',
  'artifact:read',
  'artifact:edit',
  'publish:manage',
  'support:manage',
] as const

export type Permission = (typeof permissions)[number]

const rolePermissions: Record<OrganizationRole, readonly Permission[]> = {
  owner: permissions,
  admin: [
    'workspace:read',
    'workspace:update',
    'member:read',
    'member:invite',
    'member:remove',
    'member:update_role',
    'invitation:read',
    'invitation:revoke',
    'audit:read',
    'audit:export',
    'audit:manage',
    'identity:manage',
    'brand:manage',
    'release:create',
    'release:approve',
    'artifact:read',
    'artifact:edit',
    'publish:manage',
  ],
  creator: ['workspace:read', 'member:read', 'release:create', 'artifact:read', 'artifact:edit'],
  approver: ['workspace:read', 'member:read', 'artifact:read', 'release:approve'],
  publisher: ['workspace:read', 'member:read', 'artifact:read', 'publish:manage'],
  viewer: ['workspace:read', 'member:read', 'artifact:read'],
}

export const betterAuthOrganizationRoles = {
  owner: defaultRoles.owner,
  admin: defaultRoles.admin,
  member: defaultRoles.member,
  creator: defaultAc.newRole({ ac: ['read'] }),
  approver: defaultAc.newRole({ ac: ['read'] }),
  publisher: defaultAc.newRole({ ac: ['read'] }),
  viewer: defaultAc.newRole({ ac: ['read'] }),
}

export function hasPermission(role: string, permission: Permission): boolean {
  return rolePermissions[normalizeOrganizationRole(role)].includes(permission)
}

export function normalizeOrganizationRole(role: string): OrganizationRole {
  if (role === 'member') {
    return 'viewer'
  }

  return organizationRoles.includes(role as OrganizationRole)
    ? (role as OrganizationRole)
    : 'viewer'
}

export function isSupportedOrganizationRole(role: string): boolean {
  return role === 'member' || organizationRoles.includes(role as OrganizationRole)
}
