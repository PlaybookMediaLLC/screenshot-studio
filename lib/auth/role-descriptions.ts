import type { OrganizationRole, Permission } from './permissions'

/** Human descriptions shared by invitations and the role matrix. */
export const roleSummaries: Record<OrganizationRole, string> = {
  owner: 'Full access, including ownership and billing.',
  admin:
    'Manage members, accounts, brand, approvals, and publishing. Billing stays with the owner.',
  creator: 'Create and edit drafts; cannot approve or publish.',
  approver: 'Review and approve content; cannot publish.',
  publisher: 'Schedule and publish approved content.',
  writer_publisher:
    'Create and edit drafts, then schedule and publish approved content. Cannot approve.',
  viewer: 'View content without making changes.',
}

/** Capabilities mapped to the same permissions used by the server. */
export const roleCapabilities: { label: string; permission: Permission }[] = [
  { label: 'Create drafts', permission: 'artifact:edit' },
  { label: 'Approve', permission: 'release:approve' },
  { label: 'Publish', permission: 'publish:manage' },
  { label: 'Manage members', permission: 'member:update_role' },
  { label: 'Manage accounts', permission: 'connection:manage' },
  { label: 'Manage billing', permission: 'billing:manage' },
]

/** Human role names without changing the distinct stored permission assignments. */
export const roleLabels: Record<OrganizationRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  creator: 'Write',
  approver: 'Approver',
  publisher: 'Publisher',
  writer_publisher: 'Write & Publish',
  viewer: 'Read-only',
}
