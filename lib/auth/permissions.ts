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
  'audit:read',
  'audit:export',
  'audit:manage',
  'identity:manage',
  'member:manage',
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
    'audit:read',
    'audit:export',
    'audit:manage',
    'identity:manage',
    'member:manage',
    'brand:manage',
    'release:create',
    'release:approve',
    'artifact:read',
    'artifact:edit',
    'publish:manage',
  ],
  creator: ['release:create', 'artifact:read', 'artifact:edit'],
  approver: ['artifact:read', 'release:approve'],
  publisher: ['artifact:read', 'publish:manage'],
  viewer: ['artifact:read'],
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
