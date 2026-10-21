import type { OrganizationRole, Permission } from './permissions'

/** Human descriptions shared by invitations and the role matrix. */
export const roleSummaries: Record<OrganizationRole, string> = {
  owner: 'Full access, including ownership and billing.',
  admin: 'Manage members, billing, brand, approvals, and publishing.',
  creator: 'Create and edit drafts; cannot approve or publish.',
  approver: 'Review and approve content; cannot publish.',
  publisher: 'Schedule and publish approved content.',
  viewer: 'View content without making changes.',
}

/** Capabilities mapped to the same permissions used by the server. */
export const roleCapabilities: { label: string; permission: Permission }[] = [
  { label: 'Create drafts', permission: 'artifact:edit' },
  { label: 'Approve', permission: 'release:approve' },
  { label: 'Publish', permission: 'publish:manage' },
  { label: 'Manage members', permission: 'member:update_role' },
  { label: 'Manage billing', permission: 'workspace:update' },
]
