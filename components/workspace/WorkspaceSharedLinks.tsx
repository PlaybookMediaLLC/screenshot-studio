'use client'

import { useCallback, useEffect, useState } from 'react'
import { Group, Pill, Row, Section } from '@/components/platform-ui'
import { Alert, AlertDescription } from '@/components/ui/alert'
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
import { Button } from '@/components/ui/button'
import {
  isLive,
  SHARE_ACCESS_LABELS,
  type ShareLink,
  shareLinkSchema,
  shareUrl,
} from '@/lib/sharing/schema'
import { useTRPCClient } from '@/lib/trpc/react'
import { getErrorMessage } from './settings-client'

function status(link: ShareLink): { label: string; tone: 'gray' | 'green' } {
  if (link.revokedAt) return { label: 'Revoked', tone: 'gray' }
  if (!isLive(link)) return { label: 'Expired', tone: 'gray' }
  return {
    label: link.expiresAt ? `Live until ${link.expiresAt.toLocaleDateString()}` : 'Live',
    tone: 'green',
  }
}

/** Every design the workspace published: copy, change who can open it, or revoke it. */
export function WorkspaceSharedLinks({ canEdit }: { canEdit: boolean }) {
  const trpcClient = useTRPCClient()
  const [links, setLinks] = useState<ShareLink[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [revoking, setRevoking] = useState<ShareLink | null>(null)

  const load = useCallback(() => {
    trpcClient.shareLink.list
      .query()
      .then((result) => setLinks(result.shareLinks.map((link) => shareLinkSchema.parse(link))))
      .catch((failure: unknown) => setError(getErrorMessage(failure)))
  }, [trpcClient])

  useEffect(load, [load])

  async function run(link: ShareLink, action: () => Promise<unknown>) {
    setBusy(link.id)
    setError(null)
    try {
      await action()
      load()
    } catch (failure) {
      setError(getErrorMessage(failure))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <Section
        description="Publish from the editor with Share. Revoking a link turns it off everywhere it was posted or embedded."
        title="Links"
      >
        <Group>
          {links === null ? (
            <Row>
              <p className="text-sm text-neutral-500">Loading…</p>
            </Row>
          ) : links.length === 0 ? (
            <Row>
              <p className="text-sm text-neutral-500">Nothing has been shared yet.</p>
            </Row>
          ) : (
            links.map((link) => {
              const live = isLive(link)
              const { label, tone } = status(link)
              const url = shareUrl(window.location.origin, link.token)
              return (
                <div
                  className="flex flex-col gap-3 px-5 py-4 md:flex-row md:items-center md:justify-between"
                  key={link.id}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm text-white">{link.title}</p>
                    <p className="truncate text-xs text-neutral-500">
                      {link.mediaType} · {SHARE_ACCESS_LABELS[link.access]} ·{' '}
                      {link.createdAt.toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <Pill tone={tone}>{label}</Pill>
                    {live ? (
                      <>
                        <Button
                          onClick={() =>
                            void navigator.clipboard.writeText(url).then(() => {
                              setCopied(link.id)
                              setTimeout(() => setCopied(null), 1500)
                            })
                          }
                          size="sm"
                          variant="outline"
                        >
                          {copied === link.id ? 'Copied' : 'Copy link'}
                        </Button>
                        {canEdit ? (
                          <>
                            <Button
                              disabled={busy === link.id}
                              onClick={() =>
                                void run(link, () =>
                                  trpcClient.shareLink.update.mutate({
                                    access: link.access === 'PUBLIC' ? 'WORKSPACE' : 'PUBLIC',
                                    id: link.id,
                                  })
                                )
                              }
                              size="sm"
                              variant="outline"
                            >
                              {link.access === 'PUBLIC' ? 'Limit to workspace' : 'Allow anyone'}
                            </Button>
                            <Button
                              aria-label={`Revoke ${link.title}`}
                              disabled={busy === link.id}
                              onClick={() => setRevoking(link)}
                              size="sm"
                              variant="destructive"
                            >
                              Revoke
                            </Button>
                          </>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                </div>
              )
            })
          )}
        </Group>
      </Section>
      <AlertDialog onOpenChange={(open) => !open && setRevoking(null)} open={revoking !== null}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke “{revoking?.title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The link stops working everywhere it was posted or embedded. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const link = revoking
                if (link) void run(link, () => trpcClient.shareLink.revoke.mutate({ id: link.id }))
              }}
            >
              Revoke link
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
