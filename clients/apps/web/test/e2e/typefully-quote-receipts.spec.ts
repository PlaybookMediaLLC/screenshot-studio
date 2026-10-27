import { expect } from '@playwright/test'
import { configureE2EFlow, test } from './framework/flow'
import { createDraftWorkspace, type DraftWorkspace } from './framework/content-drafts'
import { apiRequest, unbindTestGoOrganization } from './framework/publishing'
import { createE2EDatabase } from './framework/services'
import { importedBody } from '@/lib/write/import-text'

configureE2EFlow()
test('pending and rejected native quote receipts remain published and never offer a duplicate retry', async ({
  page,
  identity,
}) => {
  let workspace: DraftWorkspace | null = null
  const database = createE2EDatabase()
  try {
    workspace = await createDraftWorkspace(identity, page, ['x'])
    const created = await apiRequest(page, '/api/v1/content-drafts', {
      method: 'POST',
      body: {
        body: importedBody(['Confirmed quote']),
        plainText: 'Confirmed quote',
        channelConnectionIds: [workspace.channels.x],
      },
    })
    expect(created.status).toBe(201)
    const draft = created.body as { id: string; version: number }
    const queued = await apiRequest(page, `/api/v1/content-drafts/${draft.id}/schedule`, {
      method: 'POST',
      body: {
        version: draft.version,
        scheduledFor: new Date(Date.now() + 86400000).toISOString(),
        channelConnectionIds: [workspace.channels.x],
      },
    })
    expect(queued.status).toBe(201)
    // This verifies the stored receipt projection, not live Mastodon federation.
    const quotes = [
      { postId: 'root', state: 'pending' },
      { postId: 'reply', state: 'rejected' },
      { postId: 'last', state: 'unconfirmed' },
    ]
    await database.query(
      `UPDATE scheduled_post SET status='PUBLISHED',"remotePostId"='root',"publishedAt"=now(),"threadProgress"=$2 WHERE "contentDraftId"=$1`,
      [draft.id, JSON.stringify({ posted: 0, total: 0, quotes })]
    )
    await page.goto(`/write/${draft.id}`)
    const post = page.getByTestId('draft-post')
    for (const quote of quotes)
      await expect(post).toContainText(
        `Native quote on post ${quote.postId}: ${quote.state} when published.`
      )
    await expect(post).toContainText('Do not republish it to retry approval')
    await expect(post.getByRole('button', { name: 'Retry this destination' })).toHaveCount(0)
    await expect(post.getByRole('button', { name: 'Post the rest' })).toHaveCount(0)
    await page.reload()
    await expect(post).toContainText('unconfirmed when published')
    expect(
      (
        await database.query(
          `SELECT count(*)::int AS n FROM scheduled_post WHERE "contentDraftId"=$1`,
          [draft.id]
        )
      ).rows[0].n
    ).toBe(1)
  } finally {
    await database.end()
    await workspace?.provider.close()
    await unbindTestGoOrganization(workspace?.organizationId ?? null)
  }
})
