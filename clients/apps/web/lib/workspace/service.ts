import 'server-only'

import type { OrganizationAccess, SessionAccess } from '@/lib/auth/access'
import { backendSDK } from '@/lib/backend/sdk'
import type {
  WorkspaceDeletion as BackendWorkspaceDeletion,
  WorkspaceInvitationDetail as BackendWorkspaceInvitationDetail,
  WorkspaceSettings as BackendWorkspaceSettings,
} from 'screenshot-studio-backend-sdk'
import { normalizeOrganizationRole } from '@/lib/auth/permissions'
import type { WorkspaceCreateInput, WorkspaceInviteInput, WorkspaceUpdateInput } from './schemas'

function fromBackendSettings(settings: BackendWorkspaceSettings) {
  return {
    ...settings,
    createdAt: new Date(settings.createdAt),
    updatedAt: new Date(settings.updatedAt),
  }
}

function fromBackendDeletion(deletion: BackendWorkspaceDeletion) {
  return {
    ...deletion,
    scheduledFor: new Date(deletion.scheduledFor),
    cancelledAt: deletion.cancelledAt ? new Date(deletion.cancelledAt) : null,
    processingAt: deletion.processingAt ? new Date(deletion.processingAt) : null,
    purgedAt: deletion.purgedAt ? new Date(deletion.purgedAt) : null,
    createdAt: new Date(deletion.createdAt),
    updatedAt: new Date(deletion.updatedAt),
  }
}

function fromBackendInvitationDetail(invitation: BackendWorkspaceInvitationDetail) {
  return {
    ...invitation,
    createdAt: new Date(invitation.createdAt),
    expiresAt: new Date(invitation.expiresAt),
    role: invitation.role ? normalizeOrganizationRole(invitation.role) : null,
  }
}

export async function createWorkspace(access: SessionAccess, input: WorkspaceCreateInput) {
  const result = await backendSDK({ ...access, organizationId: '' }).createWorkspace(input)
  return { organization: result.organization, settings: fromBackendSettings(result.settings) }
}

export async function listWorkspaces(access: SessionAccess) {
  const result = await backendSDK({ ...access, organizationId: '' }).listWorkspaces()
  return result.workspaces
}

export async function setActiveWorkspace(access: SessionAccess, organizationId: string) {
  await backendSDK({ ...access, organizationId: '' }).setActiveWorkspace(organizationId)
}

export async function getWorkspace(access: OrganizationAccess) {
  const { workspace } = await backendSDK(access).getWorkspace()
  return (
    workspace && {
      ...workspace,
      workspaceSettings: workspace.workspaceSettings
        ? fromBackendSettings(workspace.workspaceSettings)
        : null,
    }
  )
}

export async function updateWorkspace(access: OrganizationAccess, input: WorkspaceUpdateInput) {
  const result = await backendSDK(access).updateWorkspace(input)
  return { organization: result.organization, settings: fromBackendSettings(result.settings) }
}

export async function listWorkspaceMembers(access: OrganizationAccess) {
  const result = await backendSDK(access).listWorkspaceMembers()
  return result.members.map((item) => ({
    ...item,
    createdAt: new Date(item.createdAt),
    role: normalizeOrganizationRole(item.role),
  }))
}

export async function listWorkspaceInvitations(access: OrganizationAccess) {
  const result = await backendSDK(access).listWorkspaceInvitations()
  return result.invitations.map((item) => ({
    ...item,
    createdAt: new Date(item.createdAt),
    expiresAt: new Date(item.expiresAt),
    role: item.role ? normalizeOrganizationRole(item.role) : null,
  }))
}

export async function inviteWorkspaceMember(
  access: OrganizationAccess,
  input: WorkspaceInviteInput
) {
  return fromBackendInvitationDetail(await backendSDK(access).inviteWorkspaceMember(input))
}

export async function resendWorkspaceInvitation(access: OrganizationAccess, invitationId: string) {
  return fromBackendInvitationDetail(
    await backendSDK(access).resendWorkspaceInvitation(invitationId)
  )
}

export async function revokeWorkspaceInvitation(access: OrganizationAccess, invitationId: string) {
  return backendSDK(access).revokeWorkspaceInvitation(invitationId)
}

export async function updateWorkspaceMemberRole(
  access: OrganizationAccess,
  memberId: string,
  role: string
) {
  const updated = await backendSDK(access).updateWorkspaceMemberRole(memberId, role)
  return {
    ...updated,
    createdAt: new Date(updated.createdAt),
    role: normalizeOrganizationRole(updated.role),
  }
}

export async function removeWorkspaceMember(access: OrganizationAccess, memberId: string) {
  await backendSDK(access).removeWorkspaceMember(memberId)
  return
}

export async function leaveWorkspace(access: OrganizationAccess) {
  await backendSDK(access).leaveWorkspace()
  return
}

export async function transferWorkspaceOwnership(access: OrganizationAccess, memberId: string) {
  await backendSDK(access).transferWorkspaceOwnership(memberId)
  return
}

export async function requestWorkspaceDeletion(access: OrganizationAccess, confirmation: string) {
  return fromBackendDeletion(await backendSDK(access).requestWorkspaceDeletion(confirmation))
}

export async function cancelWorkspaceDeletion(access: SessionAccess) {
  return fromBackendDeletion(
    await backendSDK({ ...access, organizationId: '' }).cancelWorkspaceDeletion()
  )
}
