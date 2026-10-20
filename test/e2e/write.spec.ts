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
 * Write (RFC 042) end to end: the library, the composer, platform
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

test('the library organizes drafts: tags, pins, kinds, duplicates, copies to a same-named set, bulk delete, the command palette and the Plan calendar', async ({
  identity,
  page,
}) => {
  test.setTimeout(300_000)
  let workspace: DraftWorkspace | null = null
  const rows = () => page.getByTestId('draft-row')
  const rowMenu = async (title: string) => {
    await rows().filter({ hasText: title }).first().hover()
    await page
      .getByRole('button', { name: `Actions for ${title}` })
      .first()
      .click()
  }
  // Menu items are chosen from the keyboard: their open animation can keep
  // Playwright's stability check from settling.
  const choose = async (name: string) => {
    const prefix = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)
    const item = page.getByRole('menuitem', { name: prefix }).last()
    await item.focus()
    await page.keyboard.press('Enter')
  }
  try {
    workspace = await createDraftWorkspace(identity, page)
    const first = await newDraft(page)
    await draftEditor(page).click()
    await settle(page)
    await page.keyboard.type('First draft about pricing')
    await page.getByRole('textbox', { name: 'Draft title' }).fill('Pricing')
    await expectSaved(page)

    // A tag of this set, put on the draft from its row, then used as a filter.
    await page.goto('/write')
    await page.getByRole('button', { name: 'Draft filters' }).click()
    await choose('Manage tags…')
    await page.getByLabel('Tag name').fill('Launch')
    await page.getByRole('button', { name: 'Create tag' }).click()
    await expect(page.getByRole('dialog')).toContainText('Launch')
    await page.keyboard.press('Escape')
    await rowMenu('Pricing')
    await page.getByRole('menuitem', { name: 'Tag this draft' }).click()
    await page
      .getByRole('menuitemcheckbox', { name: 'Launch' })
      .or(page.getByRole('menuitem', { name: 'Launch' }))
      .click()
    await page.keyboard.press('Escape')

    // Pin it; a pinned draft comes first and says so.
    await rowMenu('Pricing')
    await choose('Pin draft')
    await expect(rows().first().getByLabel('Pinned')).toBeVisible()

    // A reply draft carries the post it answers.
    await page.getByRole('button', { name: 'New draft of another kind' }).first().click()
    await choose('Reply to an X post')
    await page.getByLabel('Post URL').fill('https://x.com/someone/status/1234567890')
    await page.getByRole('button', { name: 'Start writing' }).click()
    await page.waitForURL(
      (url) => !url.pathname.endsWith(first) && /\/write\/[a-z0-9]+/.test(url.pathname)
    )
    await expect(page.getByTestId('draft-target')).toContainText('Replying to')
    await expect(page.getByTestId('draft-target')).toContainText('x.com/someone/status/1234567890')

    // Duplicate: a new draft with the text, no schedule or link.
    await page.goto('/write')
    await rowMenu('Pricing')
    await choose('Duplicate')
    await expect(rows().filter({ hasText: 'Pricing' })).toHaveCount(2)

    // A second set with the same name as the default stays a separate identity.
    const setName =
      (await page.getByRole('button', { name: /^Social set: / }).textContent())?.trim() ?? ''
    await page.getByRole('button', { name: /^Social set: / }).click()
    await choose('New social set…')
    const setDialog = page.getByRole('dialog')
    await setDialog.getByRole('textbox', { name: 'Name' }).fill(setName.replace(/▾$/, '').trim())
    await setDialog.getByRole('button', { name: 'Create set' }).click()
    await expect(setDialog).toBeHidden()

    // Copy to that set: the copy is found there; the original stays here.
    // The new set is now the active one; switch back to the default (listed first).
    const switchSet = async (index: number) => {
      await page.waitForLoadState('networkidle')
      await page.getByRole('button', { name: /^Social set: / }).click()
      const item = page
        .getByRole('menuitem')
        .filter({ hasText: setName.replace(/▾$/, '').trim() })
        .nth(index)
      await item.focus()
      await page.keyboard.press('Enter')
      await page.waitForLoadState('networkidle')
    }
    await page.goto('/write')
    await expect(page.getByText('No drafts in this set.')).toBeVisible()
    await switchSet(0)
    await rowMenu('Pricing')
    await page.getByRole('menuitem', { name: 'Copy to social set' }).click()
    await page.getByRole('menu').last().getByRole('menuitem').first().click()
    await page.getByRole('button', { name: 'Copy without tags' }).click()
    await expect(page.getByText(/Copied/).first()).toBeVisible()
    // The copy opens in its set.
    await page.waitForURL(/\/write\/[a-z0-9]+\?set=/)
    await expect(draftEditor(page)).toBeVisible({ timeout: 60_000 })
    await switchSet(1)
    await expect(rows().filter({ hasText: 'Pricing' })).toHaveCount(1)
    await switchSet(0)
    // Back on the default set: the original and its duplicate.
    await expect(rows().filter({ hasText: 'Pricing' })).toHaveCount(2)

    // Select several and delete them after a confirmation.
    await rowMenu('Pricing')
    await choose('Select multiple')
    // In selection mode a click on a row selects it instead of opening it.
    await rows().filter({ hasText: 'Pricing (copy)' }).getByRole('link').click()
    const bulk = page.getByLabel('Selected drafts')
    await expect(bulk).toContainText('2 selected')
    await bulk.getByRole('button', { name: 'Delete' }).click()
    await expect(page.getByRole('alertdialog')).toContainText('Delete 2 drafts?')
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete drafts' }).click()
    await expect(rows().filter({ hasText: 'Pricing' })).toHaveCount(0, { timeout: 30_000 })
    await snap(page, 'write-library-bulk')

    // The command palette finds drafts and runs commands; the shortcut list opens and closes.
    await page.keyboard.press('ControlOrMeta+k')
    const palette = page.getByRole('dialog')
    await expect(palette).toBeVisible()
    await page.keyboard.type('reply')
    await snap(page, 'write-command-palette')
    await page.keyboard.press('Escape')
    await page.keyboard.press('ControlOrMeta+Shift+Slash')
    await expect(page.getByTestId('shortcut-reference').first()).toContainText(
      'Search and commands'
    )
    await snap(page, 'write-shortcuts')
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('shortcut-reference')).toHaveCount(0)

    // Plan: a planned draft shows dashed on the week it is planned for.
    const planned = await newDraft(page)
    await draftEditor(page).click()
    await settle(page)
    await page.keyboard.type('Planned, not scheduled')
    await expectSaved(page)
    await page.getByTestId('schedule-button').click()
    await page
      .getByTestId('schedule-dialog')
      .getByRole('button', { name: /^Tomorrow 9:00/ })
      .click()
    await page
      .getByTestId('schedule-dialog')
      .getByRole('button', { name: 'Save as planned' })
      .click()
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
    await page.goto(`/write/plan?week=${tomorrow}`)
    await expect(page.locator(`[data-testid="calendar-planned"][href$="${planned}"]`)).toBeVisible({
      timeout: 30_000,
    })
    await snap(page, 'write-plan')
  } finally {
    await workspace?.provider.close()
    await unbindTestGoOrganization(workspace?.organizationId ?? null)
  }
})
