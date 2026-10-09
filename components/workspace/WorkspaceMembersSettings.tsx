'use client'

import { type FormEvent, useCallback, useEffect, useState } from 'react'
import { z } from 'zod'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Group, Pill, Row, Section } from '@/components/platform-ui'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useTRPCClient } from '@/lib/trpc/react'
import { getErrorMessage } from './settings-client'

const assignableRoles = ['admin', 'creator', 'approver', 'publisher', 'viewer'] as const
type AssignableRole = (typeof assignableRoles)[number]
const invitationSchema = z.object({
  email: z.string().trim().email(),
  role: z.enum(assignableRoles),
})

type WorkspaceMember = {
  createdAt: Date | string
  id: string
  role: string
  user: { email: string; id: string; image: string | null; name: string }
}

type WorkspaceInvitation = {
  email: string
  expiresAt: Date
  id: string
  role: string | null
}

type Confirmation =
  | { member: WorkspaceMember; type: 'remove' | 'transfer' }
  | { type: 'leave' }
  | { invitation: WorkspaceInvitation; type: 'revoke' }

type WorkspaceMembersSettingsProps = {
  canInvite: boolean
  canManageMembers: boolean
  canRead: boolean
  canTransferOwnership: boolean
  currentUserId: string
}

export function WorkspaceMembersSettings({
  canInvite,
  canManageMembers,
  canRead,
  canTransferOwnership,
  currentUserId,
}: WorkspaceMembersSettingsProps) {
  const trpcClient = useTRPCClient()
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [invitations, setInvitations] = useState<WorkspaceInvitation[]>([])
  const [isLoading, setIsLoading] = useState(canRead)
  const [members, setMembers] = useState<WorkspaceMember[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    if (!canRead) {
      setIsLoading(false)
      return
    }
    setIsLoading(true)
    try {
      const [memberResult, invitationResult] = await Promise.all([
        trpcClient.workspace.listMembers.query(),
        canManageMembers ? trpcClient.workspace.listInvitations.query() : Promise.resolve(null),
      ])
      setMembers(memberResult.members)
      setInvitations(invitationResult?.invitations ?? [])
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setIsLoading(false)
    }
  }, [canManageMembers, canRead, trpcClient])

  useEffect(() => {
    void load()
  }, [load])

  async function run(
    actionId: string,
    action: () => Promise<unknown>,
    success: string
  ): Promise<void> {
    setError(null)
    setMessage(null)
    setPendingId(actionId)
    try {
      await action()
      await load()
      setMessage(success)
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setConfirmation(null)
      setPendingId(null)
    }
  }

  async function handleInvite(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    const form = event.currentTarget
    const input = invitationSchema.safeParse(Object.fromEntries(new FormData(form)))
    if (!input.success) {
      setError(input.error.issues[0]?.message ?? 'Check the invitation details.')
      return
    }
    await run(
      'invite',
      async () => {
        await trpcClient.workspace.invite.mutate(input.data)
        form.reset()
      },
      'Invitation created.'
    )
  }

  async function confirmAction(): Promise<void> {
    if (!confirmation) return
    if (confirmation.type === 'remove') {
      await run(
        confirmation.member.id,
        () => trpcClient.workspace.removeMember.mutate({ memberId: confirmation.member.id }),
        'Member removed.'
      )
      return
    }
    if (confirmation.type === 'transfer') {
      await run(
        confirmation.member.id,
        () => trpcClient.workspace.transferOwnership.mutate({ memberId: confirmation.member.id }),
        'Ownership transferred.'
      )
      return
    }
    if (confirmation.type === 'revoke') {
      await run(
        confirmation.invitation.id,
        () =>
          trpcClient.workspace.revokeInvitation.mutate({
            invitationId: confirmation.invitation.id,
          }),
        'Invitation revoked.'
      )
      return
    }
    await run('leave', () => trpcClient.workspace.leave.mutate(), 'You left the workspace.')
  }

  if (!canRead) {
    return <p className="text-sm text-neutral-500">Your role cannot view workspace members.</p>
  }

  return (
    <div className="flex flex-col gap-10">
      {canInvite ? (
        <InviteForm isSubmitting={pendingId === 'invite'} onSubmit={handleInvite} />
      ) : null}
      {message ? (
        <p
          className="rounded-lg bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300 ring-1 ring-emerald-500/20"
          role="status"
        >
          {message}
        </p>
      ) : null}
      {error ? (
        <p
          className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-300 ring-1 ring-red-500/20"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      <Group>
        {isLoading ? (
          <Row>
            <p className="text-sm text-neutral-500">Loading members…</p>
          </Row>
        ) : members.length === 0 ? (
          <Row>
            <p className="text-sm text-neutral-500">This workspace has no members yet.</p>
          </Row>
        ) : (
          <>
            <div className="px-5 py-3 text-xs font-medium text-neutral-500">
              {members.length} {members.length === 1 ? 'member' : 'members'}
            </div>
            {members.map((member) => (
              <MemberRow
                canManage={canManageMembers}
                canTransferOwnership={canTransferOwnership}
                currentUserId={currentUserId}
                isPending={pendingId === member.id}
                key={member.id}
                member={member}
                onLeave={() => setConfirmation({ type: 'leave' })}
                onRemove={() => setConfirmation({ member, type: 'remove' })}
                onRoleChange={(role) =>
                  void run(
                    member.id,
                    () =>
                      trpcClient.workspace.updateMemberRole.mutate({ memberId: member.id, role }),
                    'Member role updated.'
                  )
                }
                onTransfer={() => setConfirmation({ member, type: 'transfer' })}
              />
            ))}
          </>
        )}
      </Group>
      {canManageMembers ? (
        <Section title="Pending invitations">
          <Group>
            {isLoading ? (
              <Row>
                <p className="text-sm text-neutral-500">Loading invitations…</p>
              </Row>
            ) : invitations.length === 0 ? (
              <Row>
                <p className="text-sm text-neutral-500">No invitations are pending.</p>
              </Row>
            ) : (
              invitations.map((invitation) => (
                <div
                  className="flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-4"
                  key={invitation.id}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-white">{invitation.email}</p>
                    <p className="text-xs text-neutral-500">
                      <span className="capitalize">{invitation.role ?? 'viewer'}</span> · expires{' '}
                      {new Date(invitation.expiresAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Pill tone="yellow">Pending</Pill>
                    <Button
                      disabled={pendingId === invitation.id}
                      onClick={() =>
                        void run(
                          invitation.id,
                          () =>
                            trpcClient.workspace.resendInvitation.mutate({
                              invitationId: invitation.id,
                            }),
                          'Invitation resent.'
                        )
                      }
                      size="sm"
                      type="button"
                      variant="secondary"
                    >
                      Resend
                    </Button>
                    <Button
                      className="text-red-400 hover:text-red-300"
                      disabled={pendingId === invitation.id}
                      onClick={() => setConfirmation({ invitation, type: 'revoke' })}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      Revoke
                    </Button>
                  </div>
                </div>
              ))
            )}
          </Group>
        </Section>
      ) : null}
      <ConfirmationDialog
        confirmation={confirmation}
        isPending={pendingId !== null}
        onConfirm={() => void confirmAction()}
        onOpenChange={(open) => !open && setConfirmation(null)}
      />
    </div>
  )
}

function InviteForm({
  isSubmitting,
  onSubmit,
}: {
  isSubmitting: boolean
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>
}) {
  return (
    <form onSubmit={onSubmit}>
      <Group>
        <Row>
          <div>
            <h3 className="text-sm font-medium text-white">Invite a member</h3>
            <p className="mt-0.5 text-xs text-neutral-500">
              Send an email invitation and choose the role they join with.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_9rem_auto]">
            <Input
              aria-label="Email address"
              autoComplete="email"
              className="h-10 rounded-lg"
              name="email"
              placeholder="teammate@company.com"
              required
              type="email"
            />
            <RoleSelect name="role" />
            <Button className="h-10 rounded-lg" disabled={isSubmitting} type="submit">
              {isSubmitting ? 'Inviting…' : 'Invite'}
            </Button>
          </div>
        </Row>
      </Group>
    </form>
  )
}

function MemberRow({
  canManage,
  canTransferOwnership,
  currentUserId,
  isPending,
  member,
  onLeave,
  onRemove,
  onRoleChange,
  onTransfer,
}: {
  canManage: boolean
  canTransferOwnership: boolean
  currentUserId: string
  isPending: boolean
  member: WorkspaceMember
  onLeave: () => void
  onRemove: () => void
  onRoleChange: (role: AssignableRole) => void
  onTransfer: () => void
}) {
  const isCurrentUser = member.user.id === currentUserId
  const isOwner = member.role === 'owner'
  const displayName = member.user.name || member.user.email
  const rolePill = (
    <Pill tone={isOwner ? 'purple' : 'gray'}>
      <span className="capitalize">{member.role}</span>
    </Pill>
  )
  // The e2e suite finds a member's actions two levels up from the email line,
  // so the email <p> stays a direct child of a direct child of this row.
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-4">
      <div
        aria-hidden="true"
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-xs font-medium text-neutral-300 uppercase ring-1 ring-white/10"
      >
        {displayName.charAt(0)}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-white">
          {displayName}
          {isCurrentUser ? <span className="text-neutral-500"> (you)</span> : null}
        </p>
        <p className="truncate text-xs text-neutral-500">{member.user.email}</p>
      </div>
      <span className="hidden text-xs text-neutral-500 md:block">
        Joined {new Date(member.createdAt).toLocaleDateString()}
      </span>
      {canManage && !isOwner ? (
        <div className="flex flex-wrap items-center gap-2">
          <RoleSelect disabled={isPending} onValueChange={onRoleChange} value={member.role} />
          {canTransferOwnership ? (
            <Button
              disabled={isPending}
              onClick={onTransfer}
              size="sm"
              type="button"
              variant="secondary"
            >
              Make owner
            </Button>
          ) : null}
          <Button
            className="text-red-400 hover:text-red-300"
            disabled={isPending}
            onClick={isCurrentUser ? onLeave : onRemove}
            size="sm"
            type="button"
            variant="ghost"
          >
            {isCurrentUser ? 'Leave' : 'Remove'}
          </Button>
        </div>
      ) : isCurrentUser && !isOwner ? (
        <div className="flex items-center gap-2">
          {rolePill}
          <Button
            className="text-red-400 hover:text-red-300"
            disabled={isPending}
            onClick={onLeave}
            size="sm"
            type="button"
            variant="ghost"
          >
            Leave
          </Button>
        </div>
      ) : (
        rolePill
      )}
    </div>
  )
}

function RoleSelect({
  disabled,
  name,
  onValueChange,
  value,
}: {
  disabled?: boolean
  name?: string
  onValueChange?: (role: AssignableRole) => void
  value?: string
}) {
  return (
    <Select
      defaultValue={name ? 'viewer' : undefined}
      disabled={disabled}
      name={name}
      onValueChange={onValueChange}
      value={value}
    >
      <SelectTrigger
        aria-label="Role"
        className={name ? 'h-10 w-full rounded-lg' : 'w-32 rounded-lg'}
        size={name ? 'default' : 'sm'}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {assignableRoles.map((role) => (
          <SelectItem key={role} value={role}>
            {role}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function ConfirmationDialog({
  confirmation,
  isPending,
  onConfirm,
  onOpenChange,
}: {
  confirmation: Confirmation | null
  isPending: boolean
  onConfirm: () => void
  onOpenChange: (open: boolean) => void
}) {
  const copy =
    confirmation?.type === 'transfer'
      ? {
          action: 'Transfer ownership',
          body: `This makes ${confirmation.member.user.email} the owner and changes your role to admin.`,
        }
      : confirmation?.type === 'remove'
        ? {
            action: 'Remove member',
            body: `Remove ${confirmation.member.user.email} from this workspace?`,
          }
        : confirmation?.type === 'revoke'
          ? {
              action: 'Revoke invitation',
              body: `Revoke the invitation for ${confirmation.invitation.email}?`,
            }
          : { action: 'Leave workspace', body: 'You will lose access to this workspace.' }
  return (
    <AlertDialog onOpenChange={onOpenChange} open={confirmation !== null}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{copy.action}</AlertDialogTitle>
          <AlertDialogDescription>{copy.body}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction disabled={isPending} onClick={onConfirm}>
            {isPending ? 'Working…' : copy.action}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
