import { expect, type Locator, type Page } from '@playwright/test'
import {
  createDraftWorkspace,
  type DraftWorkspace,
  draftEditor,
  expectSaved,
} from './framework/content-drafts'
import { configureE2EFlow, test } from './framework/flow'
import { unbindTestGoOrganization } from './framework/publishing'
import { createE2EDatabase, queryRows } from './framework/services'

configureE2EFlow()

/**
 * Write (RFC 041) end to end: the library, the composer, platform
 * versions, previews, properties, planning, scheduling, backups and
 * sharing, on a desktop and a phone. Posts are scheduled for later or fail
 * against the social API mock, so nothing reaches a real account.
 */

/** A screenshot for the delivery report, once dialogs and sheets finish animating. */
async function snap(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(500)
  await page.screenshot({ path: `.context/shots/${name}.png` })
}

/** Open a new draft from the library; returns its id. */
async function newDraft(page: Page): Promise<string> {
  await page.goto('/write')
  await page.getByTestId('new-draft').first().click()
  await page.waitForURL(/\/write\/[a-z0-9]+/)
  await expect(draftEditor(page)).toBeVisible({ timeout: 60_000 })
  return new URL(page.url()).pathname.split('/').pop() ?? ''
}

/**
 * Put the caret at the end of a text leaf, past slate's 100 ms selection
 * sync (the same helper as the drafts spec).
 */
async function caretAtEndOf(page: Page, word: Locator): Promise<void> {
  const text = (await word.textContent()) ?? ''
  await expect(async () => {
    const box = await word.boundingBox()
    await word.click({ position: { x: (box?.width ?? 1) - 1, y: (box?.height ?? 2) / 2 } })
    expect(
      await page.evaluate(() => {
        const selection = window.getSelection()
        return `${selection?.anchorNode?.textContent}:${selection?.anchorOffset}`
      })
    ).toBe(`${text}:${text.length}`)
  }).toPass({ timeout: 20_000 })
  await page.waitForTimeout(300)
}

/** Wait out slate's selection sync after moving the caret. */
async function settle(page: Page): Promise<void> {
  await page.waitForTimeout(300)
}

type PostRow = { caption: string; platform: string; status: string }

async function draftPosts(draftId: string): Promise<PostRow[]> {
  const database = createE2EDatabase()
  try {
    return await queryRows<PostRow>(
      database,
      `SELECT p.caption, c.platform, p.status::text AS status
       FROM scheduled_post p JOIN channel_connection c ON c.id = p."channelConnectionId"
       WHERE p."contentDraftId" = $1 ORDER BY c.platform`,
      [draftId]
    )
  } finally {
    await database.end()
  }
}

test('a thread is written once, adapted per platform, planned, scheduled, backed up and recovered', async ({
  identity,
  page,
}) => {
  test.setTimeout(240_000)
  let workspace: DraftWorkspace | null = null
  try {
    workspace = await createDraftWorkspace(identity, page)
    const draftId = await newDraft(page)

    // The composer says who it publishes as, and every post shows its account.
    await expect(page.getByTestId('platform-tab-x')).toContainText('primary')
    await expect(page.getByTestId('platform-tab-linkedin')).toContainText('synced')

    const editor = draftEditor(page)
    await editor.click()
    await settle(page)
    await page.keyboard.type('Launch day is here.')
    await page.keyboard.press('ControlOrMeta+Enter')
    await page.keyboard.type('Second post 🚀 https://example.com/launch')
    await expectSaved(page)
    await expect(page.getByTestId('post-header')).toHaveCount(2)
    await expect(page.getByTestId('post-header').first()).toContainText('@shots_x')
    // X counts a link as 23 and an emoji as 2.
    await expect(page.getByTestId('post-length-1')).toHaveText('19 / 280')
    await expect(page.getByTestId('post-length-2')).toHaveText('38 / 280')

    // Numbering is applied when serialized and counted; the text never holds it.
    await page.getByRole('button', { name: /Auto-numbering/ }).click()
    await page.getByLabel('Enable auto-numbering').click()
    await expect(page.getByTestId('numbering-preview')).toContainText('1/2')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByTestId('post-length-1')).toHaveText(/^2\d \/ 280$/)
    await expect(editor).not.toContainText('1/2')
    await expectSaved(page)

    // LinkedIn follows X, joined into one post.
    await page.getByTestId('platform-tab-linkedin').click()
    await expect(page.getByTestId('synced-version-linkedin')).toContainText('Launch day is here.')
    await expect(page.getByTestId('synced-version-linkedin').locator('article')).toHaveCount(1)
    await snap(page, 'write-linkedin-synced')

    // Its own text: edits there stay there, and X edits no longer reach it.
    await page.getByRole('button', { name: 'Edit for LinkedIn independently' }).click()
    await expect(page.getByTestId('manual-version-linkedin')).toBeVisible()
    await editor.click()
    await settle(page)
    // The end of the document: ⌘↓ on macOS, Ctrl+End elsewhere.
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End')
    await settle(page)
    await page.keyboard.type(' Read more on our blog.')
    await expectSaved(page)
    await page.getByTestId('platform-tab-x').click()
    await expect(editor).not.toContainText('Read more on our blog.')
    await caretAtEndOf(page, editor.getByText('Launch day is here.'))
    await page.keyboard.type(' Today!')
    await expectSaved(page)

    // Previews: each platform's own text, labelled as not published, no engagement.
    await page.getByRole('button', { name: 'Preview', exact: true }).click()
    const preview = page.getByTestId('preview-panel')
    await expect(preview).toContainText('not published')
    await expect(page.getByTestId('preview-x')).toContainText('Launch day is here. Today!')
    await snap(page, 'write-preview-x')
    await preview.getByRole('button', { name: 'LinkedIn' }).click()
    await expect(page.getByTestId('preview-linkedin')).toContainText('Read more on our blog.')
    await expect(page.getByTestId('preview-linkedin')).not.toContainText('Today!')
    await snap(page, 'write-preview-linkedin')

    // Properties: an internal title and scratchpad that are never posted, and counts.
    await page.getByRole('button', { name: 'Properties', exact: true }).click()
    const properties = page.getByTestId('properties-panel')
    await properties.getByLabel('Internal title').fill('Launch thread')
    await properties.getByRole('textbox', { name: /Scratchpad/ }).fill('Ask legal about the claim')
    await expect(properties.getByTestId('word-count')).not.toHaveText('0')
    await expectSaved(page)
    await snap(page, 'write-properties')

    // Plan: on the calendar, never published by itself.
    await page.getByTestId('schedule-button').click()
    const schedule = page.getByTestId('schedule-dialog')
    await expect(schedule).toBeVisible()
    await schedule.getByRole('button', { name: /^Tomorrow 9:00/ }).click()
    await expect(page.getByTestId('schedule-summary')).toContainText('9:00')
    await snap(page, 'write-schedule')
    await schedule.getByRole('button', { name: 'Save as planned' }).click()
    await expect(schedule).toBeHidden()
    await expect(page.getByText('Planned', { exact: true }).first()).toBeVisible()
    expect(await draftPosts(draftId)).toEqual([])

    // Schedule it: one post per platform, each with its own text.
    await page.getByTestId('schedule-button').click()
    await expect(schedule).toBeVisible()
    await schedule.getByRole('button', { name: /^Tomorrow 9:00/ }).click()
    await schedule.getByRole('button', { name: /^Confirm schedule/ }).click()
    await expect(page.getByTestId('draft-post')).toHaveCount(2, { timeout: 30_000 })
    const posts = await draftPosts(draftId)
    expect(posts.map((post) => [post.platform, post.status])).toEqual([
      ['linkedin', 'SCHEDULED'],
      ['x', 'SCHEDULED'],
    ])
    expect(posts.find((post) => post.platform === 'linkedin')?.caption).toContain(
      'Read more on our blog.'
    )
    expect(posts.find((post) => post.platform === 'x')?.caption).toMatch(
      /^Launch day is here\. Today!/
    )
    expect(posts.map((post) => post.caption).join(' ')).not.toContain('Ask legal')
    await snap(page, 'write-scheduled')

    // The library: both posts in the queue; the draft found by its scratchpad, shown by its title.
    await page.goto('/write?tab=queue')
    await expect(page.getByTestId('write-rail')).toContainText('Launch day is here. Today! 1/2')
    await expect(page.getByTestId('write-rail')).toContainText('Read more on our blog.')
    await page.goto('/write?q=legal')
    await expect(page.getByTestId('draft-row')).toHaveCount(1)
    await expect(page.getByTestId('draft-row')).toContainText('Launch thread')
    await snap(page, 'write-library-search')

    // Backups: browsed, compared, and recovered as a new draft.
    await page.goto(`/write/${draftId}?panel=backups`)
    const backups = page.getByTestId('backups-browser')
    await expect(backups).toBeVisible({ timeout: 60_000 })
    await expect(page.getByTestId('backup-time')).toContainText(
      /When scheduled|When planned|While editing/
    )
    await snap(page, 'write-backups')
    await backups.getByRole('button', { name: 'Create new draft from this version' }).click()
    await page.waitForURL(
      (url) => !url.pathname.endsWith(draftId) && /\/write\/[a-z0-9]+/.test(url.pathname)
    )
    await expect(draftEditor(page)).toContainText('Launch day is here.', { timeout: 60_000 })
    expect(await draftPosts(draftId)).toHaveLength(2)

    // Sharing: copying the internal link never turns the public one on.
    await page.getByRole('button', { name: 'Share', exact: true }).click()
    const share = page.getByTestId('share-dialog')
    await expect(share.getByLabel('Public link', { exact: true })).not.toBeChecked()
    await share.getByLabel('Public link', { exact: true }).click()
    await expect(share.getByLabel('Public link to share')).toHaveValue(/\/d\//)
    const publicLink = await share.getByLabel('Public link to share').inputValue()
    await share.getByLabel('Public link', { exact: true }).click()
    await expect(share.getByLabel('Public link to share')).toHaveCount(0)
    const revoked = await page.request.get(publicLink)
    expect(revoked.status()).toBe(404)
  } finally {
    await workspace?.provider.close()
    await unbindTestGoOrganization(workspace?.organizationId ?? null)
  }
})

test('refine previews and applies only on accept, the assistant adds a post, follow-ups are set in review, and a failed destination is retried alone', async ({
  identity,
  page,
}) => {
  test.setTimeout(300_000)
  let workspace: DraftWorkspace | null = null
  try {
    workspace = await createDraftWorkspace(identity, page)
    const draftId = await newDraft(page)
    const editor = draftEditor(page)
    await editor.click()
    await settle(page)
    await page.keyboard.type('we shipped the new editor today')
    await expectSaved(page)

    // Refine: the answer is previewed; Reject leaves the text as it was.
    await page.getByRole('button', { name: 'Refine', exact: true }).click()
    await page.getByTestId('refine-menu').getByRole('button', { name: 'Fix grammar' }).click()
    const review = page.getByTestId('refine-review')
    await expect(review).toContainText('(refined)', { timeout: 60_000 })
    await snap(page, 'write-refine-review')
    await review.getByRole('button', { name: 'Reject' }).click()
    await expect(editor).toHaveText(/we shipped the new editor today/)
    await expect(editor).not.toContainText('(refined)')

    // Accept applies it as one change, and Undo takes it back.
    await page.getByRole('button', { name: 'Refine', exact: true }).click()
    await page.getByTestId('refine-menu').getByRole('button', { name: 'Make it punchier' }).click()
    await expect(review).toContainText('(refined)', { timeout: 60_000 })
    await review.getByRole('button', { name: 'Accept' }).click()
    await expect(editor).toContainText('we shipped the new editor today (refined)')
    await page.keyboard.press('ControlOrMeta+z')
    await expect(editor).not.toContainText('(refined)')
    await expect(editor).toContainText('we shipped the new editor today')
    await expectSaved(page)

    // The writing assistant, in the set's voice: set up or skipped, then asked.
    await page.getByRole('button', { name: 'Assistant', exact: true }).click()
    await expect(page.getByTestId('assistant-setup')).toBeVisible()
    await page.getByTestId('assistant-setup').getByRole('button', { name: 'Skip for now' }).click()
    const assistant = page.getByTestId('assistant-panel')
    await assistant.getByRole('button', { name: /stronger hooks/ }).click()
    await expect(assistant.getByTestId('assistant-assistant')).toHaveCount(1, { timeout: 60_000 })
    await snap(page, 'write-assistant')
    await assistant.getByRole('button', { name: 'Add as a new post' }).click()
    await expect(page.getByTestId('post-header')).toHaveCount(2)
    await expectSaved(page)

    // The review names every account and the follow-ups; Auto-DM is off, with why.
    await page.getByTestId('publish-button').click()
    const publish = page.getByTestId('publish-review')
    await expect(publish).toContainText('Publishing as')
    await expect(publish.getByTestId('review-destination')).toHaveCount(2)
    await expect(publish.getByTestId('automation-auto-dm')).toContainText('direct-message access')
    await expect(publish.getByTestId('automation-auto-dm').getByRole('switch')).toBeDisabled()
    await publish.getByTestId('automation-auto-rt').getByRole('switch').click()
    const autoRT = page.getByTestId('auto-rt-dialog')
    await expect(autoRT.getByTestId('retweet-projection')).toContainText('reposts')
    await snap(page, 'write-auto-rt')
    await autoRT.getByRole('button', { name: 'Enable Auto-RT' }).click()
    await expect(publish.getByTestId('automation-auto-rt')).toContainText(
      '6 hours after publishing'
    )
    await expect(publish).toContainText(
      'X: repost 6 hours after publishing, removed 12 hours later.'
    )
    await snap(page, 'write-publish-review')

    // Publish now: the social API mock refuses posts, so both destinations fail.
    await publish.getByRole('button', { name: 'Publish now' }).click()
    await expect(page.getByTestId('draft-post')).toHaveCount(2, { timeout: 30_000 })
    await expect
      .poll(async () => (await draftPosts(draftId)).map((post) => post.status).sort(), {
        timeout: 180_000,
      })
      .toEqual(['FAILED', 'FAILED'])
    await page.reload()
    const failed = page.getByTestId('draft-post').filter({ hasText: 'did not publish' })
    await expect(failed).toHaveCount(2, { timeout: 60_000 })
    await snap(page, 'write-failed-destinations')

    // Retrying one destination makes one new post for it; the other stays as it is.
    await failed.first().getByRole('button', { name: 'Retry this destination' }).click()
    await expect.poll(async () => (await draftPosts(draftId)).length, { timeout: 30_000 }).toBe(3)
  } finally {
    await workspace?.provider.close()
    await unbindTestGoOrganization(workspace?.organizationId ?? null)
  }
})

test('on a phone the library is the page, panels are sheets, and the review keeps the account identity', async ({
  identity,
  page,
}) => {
  test.setTimeout(240_000)
  let workspace: DraftWorkspace | null = null
  try {
    workspace = await createDraftWorkspace(identity, page)
    await page.setViewportSize({ height: 844, width: 390 })
    await page.goto('/write')
    await expect(page.getByTestId('write-rail')).toBeVisible()
    await snap(page, 'write-phone-library')
    await page.getByTestId('new-draft').first().click()
    await page.waitForURL(/\/write\/[a-z0-9]+/)
    const editor = draftEditor(page)
    await expect(editor).toBeVisible({ timeout: 60_000 })
    await editor.click()
    await settle(page)
    await page.keyboard.type('Written on a phone.')
    await expectSaved(page)
    await expect(page.getByTestId('save-state')).toBeVisible()
    await snap(page, 'write-phone-composer')

    // The library is a drawer while a draft is open.
    await page.getByRole('button', { name: 'Drafts', exact: true }).click()
    await expect(page.getByRole('dialog').getByTestId('write-rail')).toBeVisible()
    await snap(page, 'write-phone-drawer')
    await page.keyboard.press('Escape')

    // Panels open as a sheet over the draft.
    await page.getByRole('button', { name: 'Preview', exact: true }).click()
    await expect(page.getByRole('dialog').getByTestId('preview-panel')).toBeVisible()
    await expect(page.getByTestId('preview-x')).toContainText('Written on a phone.')
    await snap(page, 'write-phone-preview')
    await page.keyboard.press('Escape')

    // The final review still names the set and each account.
    await page.getByTestId('publish-button').click()
    const publish = page.getByTestId('publish-review')
    await expect(publish).toContainText('Publishing as')
    await expect(publish.getByTestId('review-destination').first()).toContainText('@shots_')
    await snap(page, 'write-phone-review')
  } finally {
    await workspace?.provider.close()
    await unbindTestGoOrganization(workspace?.organizationId ?? null)
  }
})
