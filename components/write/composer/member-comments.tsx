'use client'

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

import * as React from 'react'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { LocalTime } from '@/components/drafts/local-time'
import { DraftRequestError, draftsApi, type DraftWire } from '@/lib/content-drafts/client'
import { readDiscussions } from '@/lib/content-drafts/discussions'
import type { DraftCommentInput } from '@/lib/api/contracts/draft-comments'
import { useTRPCClient } from '@/lib/trpc/react'

const memberSchema = z.object({ user: z.object({ id: z.string(), name: z.string() }) })
const membersSchema = z.object({ members: z.array(memberSchema) })
const commentSchema = z.object({
  id: z.string(),
  userId: z.string(),
  createdAt: z.coerce.date(),
  contentRich: z.unknown(),
  isEdited: z.boolean().optional(),
})
const threadSchema = z.object({
  id: z.string(),
  userId: z.string(),
  scope: z.literal('draft').optional(),
  documentContent: z.string().optional(),
  isResolved: z.boolean(),
  comments: z.array(commentSchema),
})
const composerSchema = z.object({
  text: z.string(),
  mentionUserIds: z.array(z.string()),
  threadId: z.string().optional(),
  commentId: z.string().optional(),
})
type Composer = z.infer<typeof composerSchema>
type Member = z.infer<typeof memberSchema>
const blank = composerSchema.parse({ text: '', mentionUserIds: [] })

// Read only explicit text and mention nodes. Never render comment HTML.
function content(
  value: unknown,
  names?: Map<string, string>
): { text: string; mentions: string[] } {
  const parts: string[] = [],
    mentions: string[] = []
  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      node.forEach(visit)
      return
    }
    const record = z.record(z.string(), z.unknown()).safeParse(node)
    if (!record.success) return
    if (record.data.type === 'mention' && typeof record.data.key === 'string') {
      mentions.push(record.data.key)
      if (names) parts.push(`@${names.get(record.data.key) ?? 'Member'}`)
    } else if (typeof record.data.text === 'string') parts.push(record.data.text)
    visit(record.data.children)
  }
  visit(value)
  return { text: parts.join('').trim(), mentions }
}

/** Comment-only controls for members whose draft editor is read-only. */
export function MemberComments({
  draft,
  currentUserId,
  onDraft,
}: {
  draft: DraftWire
  currentUserId: string
  onDraft: (draft: DraftWire) => void
}) {
  const client = useTRPCClient()
  const [members, setMembers] = React.useState<Member[]>([])
  const [composer, setComposer] = React.useState<Composer>(blank)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [needsRefresh, setNeedsRefresh] = React.useState(false)
  const formRef = React.useRef<HTMLTextAreaElement>(null)
  const pending = React.useRef<DraftCommentInput | null>(null)
  React.useEffect(() => {
    let active = true
    void client.workspace.listMembers
      .query()
      .then((result) => {
        if (active) setMembers(membersSchema.parse(result).members)
      })
      .catch(() => {
        if (active) setMembers([])
      })
    return () => {
      active = false
    }
  }, [client])
  const discussions = readDiscussions(draft.discussions)
  const threads = discussions.threads.flatMap((value) => {
    const parsed = threadSchema.safeParse(value)
    return parsed.success ? [parsed.data] : []
  })
  const names = new Map(members.map((member) => [member.user.id, member.user.name]))
  for (const [id, user] of Object.entries(discussions.users))
    if (!names.has(id)) names.set(id, user.name)
  const start = (next: Composer) => {
    setComposer(next)
    formRef.current?.focus()
  }
  const refresh = async () => {
    setBusy(true)
    try {
      const fresh = await draftsApi.get(draft.id)
      onDraft(fresh)
      const attempt = pending.current
      if (
        attempt?.action === 'add' &&
        readDiscussions(fresh.discussions).threads.some((thread) =>
          thread.comments.some((comment) => comment.id === attempt.commentId)
        )
      )
        setComposer(blank)
      pending.current = null
      setNeedsRefresh(false)
      setError(null)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Comments could not be loaded.')
    } finally {
      setBusy(false)
    }
  }
  const act = async (input: DraftCommentInput) => {
    setBusy(true)
    setError(null)
    pending.current = input
    try {
      onDraft({ ...draft, ...(await draftsApi.comment(draft.id, input)) })
      if (
        input.action === 'add' ||
        input.action === 'edit' ||
        (input.action === 'delete' && input.commentId === composer.commentId)
      )
        setComposer(blank)
      pending.current = null
      return true
    } catch (failure) {
      const denied =
        failure instanceof DraftRequestError && [401, 403, 404].includes(failure.status)
      setError(
        denied
          ? 'You no longer have permission for this comment action.'
          : 'The comment was not confirmed. Refresh comments to check the saved result before trying again.'
      )
      setNeedsRefresh(true)
      return false
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex flex-col gap-4 p-4 text-sm" data-testid="member-comments-panel">
      <p className="text-xs text-muted-foreground">
        You can comment and reply while the draft stays read-only. You can edit or delete your own
        comments.
      </p>
      <div className="flex items-center justify-between">
        <h3 className="font-medium">Team comments</h3>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void refresh()}>
          Refresh comments
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-amber-200">
          {error}
        </p>
      ) : null}
      <form
        className="grid gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          const common = {
            baseVersion: draft.version,
            text: composer.text,
            mentionUserIds: composer.mentionUserIds,
          }
          void act(
            composer.commentId && composer.threadId
              ? {
                  ...common,
                  action: 'edit',
                  threadId: composer.threadId,
                  commentId: composer.commentId,
                }
              : {
                  ...common,
                  action: 'add',
                  threadId: composer.threadId,
                  commentId: crypto.randomUUID(),
                }
          )
        }}
      >
        <label className="text-xs text-foreground" htmlFor="member-comment-text">
          {composer.commentId
            ? 'Edit your comment'
            : composer.threadId
              ? 'Reply to discussion'
              : 'Comment on draft'}
        </label>
        <textarea
          id="member-comment-text"
          ref={formRef}
          className="min-h-24 rounded-md border border-border bg-background p-2"
          maxLength={5000}
          required
          disabled={busy}
          value={composer.text}
          onChange={(event) => setComposer({ ...composer, text: event.target.value })}
        />
        {members.length > 0 ? (
          <label className="grid gap-1 text-xs text-muted-foreground">
            Mention teammates
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  className="justify-between"
                  disabled={busy}
                  aria-label="Mention teammates"
                >
                  {composer.mentionUserIds.length
                    ? `${composer.mentionUserIds.length} teammates selected`
                    : 'Choose teammates'}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="max-h-60 overflow-y-auto">
                {members
                  .filter((member) => member.user.id !== currentUserId)
                  .map((member) => (
                    <DropdownMenuCheckboxItem
                      key={member.user.id}
                      checked={composer.mentionUserIds.includes(member.user.id)}
                      onSelect={(event) => event.preventDefault()}
                      onCheckedChange={(checked) =>
                        setComposer({
                          ...composer,
                          mentionUserIds: checked
                            ? [...composer.mentionUserIds, member.user.id]
                            : composer.mentionUserIds.filter((id) => id !== member.user.id),
                        })
                      }
                    >
                      {member.user.name}
                    </DropdownMenuCheckboxItem>
                  ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </label>
        ) : null}
        <div className="flex gap-2">
          <Button size="sm" type="submit" disabled={busy || needsRefresh || !composer.text.trim()}>
            {busy
              ? 'Saving…'
              : composer.commentId
                ? 'Save comment'
                : composer.threadId
                  ? 'Send reply'
                  : 'Add comment'}
          </Button>
          {composer.threadId ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => setComposer(blank)}
              type="button"
            >
              Cancel
            </Button>
          ) : null}
        </div>
      </form>
      {threads.length === 0 ? (
        <p className="text-sm text-muted-foreground">No team comments yet.</p>
      ) : null}
      {threads.map((thread) => (
        <section
          key={thread.id}
          data-testid="member-comment-thread"
          className="grid gap-3 rounded-lg border border-border p-3"
        >
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {thread.isResolved ? 'Resolved' : 'Open'} ·{' '}
              {thread.scope === 'draft' ? 'Draft discussion' : 'Text discussion'}
            </span>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy || needsRefresh}
              onClick={() =>
                void act({
                  action: 'resolve',
                  baseVersion: draft.version,
                  threadId: thread.id,
                  resolved: !thread.isResolved,
                })
              }
            >
              {thread.isResolved ? 'Reopen' : 'Resolve'}
            </Button>
          </div>
          {thread.documentContent ? (
            <blockquote className="border-l-2 border-amber-300/50 pl-2 text-xs text-muted-foreground">
              {thread.documentContent}
            </blockquote>
          ) : null}
          {thread.comments.map((comment) => {
            const value = content(comment.contentRich)
            return (
              <article key={comment.id} data-testid="member-comment" className="grid gap-1">
                <p className="text-xs text-muted-foreground">
                  {names.get(comment.userId) ?? 'Member'} ·{' '}
                  <LocalTime value={comment.createdAt.toISOString()} />
                  {comment.isEdited ? ' · Edited' : ''}
                </p>
                <p className="whitespace-pre-wrap break-words text-foreground">
                  {content(comment.contentRich, names).text}
                </p>
                {comment.userId === currentUserId ? (
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy || needsRefresh}
                      onClick={() =>
                        start({
                          ...value,
                          mentionUserIds: value.mentions,
                          threadId: thread.id,
                          commentId: comment.id,
                        })
                      }
                    >
                      Edit comment
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy || needsRefresh}
                      onClick={() =>
                        void act({
                          action: 'delete',
                          baseVersion: draft.version,
                          threadId: thread.id,
                          commentId: comment.id,
                        })
                      }
                    >
                      Delete comment
                    </Button>
                  </div>
                ) : null}
              </article>
            )
          })}
          <Button
            className="justify-self-start"
            size="sm"
            variant="outline"
            disabled={busy || needsRefresh}
            onClick={() => start({ ...blank, threadId: thread.id })}
          >
            Reply
          </Button>
        </section>
      ))}
      {draft.guestComments.length > 0 ? (
        <section className="grid gap-2">
          <h3 className="text-xs text-muted-foreground">From the public link</h3>
          {draft.guestComments.map((comment, index) => (
            <p key={index}>
              <span className="text-muted-foreground">{comment.name}: </span>
              {comment.text}
            </p>
          ))}
        </section>
      ) : null}
    </div>
  )
}
