import { z } from 'zod'
import { contentDraftSchema } from '../../lib/api/contracts/content-drafts'
import {
  createDraftWorkspace,
  draftEditor,
  expectSaved,
  openNewDraft,
} from './framework/content-drafts'
import { configureE2EFlow, expect, test } from './framework/flow'
import { apiRequest, unbindTestGoOrganization } from './framework/publishing'
import { createE2EDatabase } from './framework/services'

configureE2EFlow()

const draftReceiptSchema = contentDraftSchema.pick({ id: true, version: true, plainText: true })

test('X composer reads verified limits and keeps Basic Articles unavailable', async ({
  identity,
  page,
}) => {
  const workspace = await createDraftWorkspace(identity, page, ['x'])
  const database = createE2EDatabase()
  try {
    const integrationId = `social-${workspace.organizationId}-x`
    // Editable historical metadata cannot grant a long-post allowance.
    await database.query(`UPDATE "Integration" SET "additionalSettings"=$2 WHERE id=$1`, [
      integrationId,
      JSON.stringify([{ title: 'Verified', value: true }]),
    ])
    const id = await openNewDraft(page)
    await draftEditor(page).fill('a'.repeat(281))
    await expectSaved(page)
    await expect(page.getByTestId('post-length-1')).toHaveText('281 / 280')

    // Simulate the authenticated provider's Basic proof, not a UI billing switch.
    await database.query(
      `UPDATE "Integration" SET "verifiedCapabilities" = jsonb_set(
      "verifiedCapabilities"::jsonb, '{x}', "verifiedCapabilities"::jsonb->'x' || $2::jsonb)
      WHERE id=$1`,
      [
        integrationId,
        JSON.stringify({
          subscriptionType: 'Basic',
          longPostMaxWeightedCharacters: 25000,
          articles: false,
        }),
      ]
    )
    await page.reload()
    await expect(page.getByTestId('post-length-1')).toHaveText('281 / 25000')
    await expect(draftEditor(page).getByText('a'.repeat(281), { exact: true })).toBeVisible()
    const saved = await apiRequest(page, `/api/v1/content-drafts/${id}`)
    expect(saved.status).toBe(200)
    expect(draftReceiptSchema.parse(saved.body).plainText).toBe('a'.repeat(281))
    await page.getByRole('button', { name: 'Manage platforms', exact: true }).click()
    await expect(page.getByRole('dialog')).toContainText('longer posts verified')
    await page.getByRole('button', { name: 'Done', exact: true }).click()
    await page.screenshot({
      path: '.context/x-content-basic-long-post.png',
      animations: 'disabled',
    })

    const created = await apiRequest(page, '/api/v1/content-drafts', {
      method: 'POST',
      body: {
        kind: 'article',
        article: { title: 'Basic account article' },
        body: [{ type: 'p', children: [{ text: 'An article needs separate access.' }] }],
      },
    })
    expect(created.status).toBe(201)
    const article = draftReceiptSchema.parse(created.body)
    await page.goto(`/write/${article.id}`)
    await expect(draftEditor(page)).toBeVisible()
    await page.getByRole('button', { name: 'Preview', exact: true }).click()
    await expect(page.getByTestId('preview-panel')).toContainText('Connect an eligible account.')
    await page.screenshot({ path: '.context/x-content-basic-article.png', animations: 'disabled' })
    const denied = await apiRequest(page, `/api/v1/content-drafts/${article.id}/schedule`, {
      method: 'POST',
      body: {
        channelConnectionIds: [workspace.channels.x],
        version: article.version,
        scheduledFor: new Date(Date.now() + 86400000).toISOString(),
      },
    })
    expect(denied.status).toBe(409)
    const scheduled = await database.query(
      'SELECT id FROM scheduled_post WHERE "contentDraftId" IN ($1,$2)',
      [id, article.id]
    )
    expect(z.array(z.object({ id: z.string() })).parse(scheduled.rows)).toHaveLength(0)
  } finally {
    await database.end()
    await unbindTestGoOrganization(workspace.organizationId)
    await workspace.provider.close()
  }
})
