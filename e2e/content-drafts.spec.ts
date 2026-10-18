import { readFile } from 'node:fs/promises'
import { expect, type Locator, type Page } from '@playwright/test'
import JSZip from 'jszip'
import {
  createDraftWorkspace,
  type DraftWorkspace,
  draftEditor,
  expectSaved,
  openNewDraft,
} from './framework/content-drafts'
import { buildDocx } from './fixtures/docx'
import { configureE2EFlow, test } from './framework/flow'
import {
  apiRequest,
  createPublishingWorkspace,
  png,
  unbindTestGoOrganization,
} from './framework/publishing'
import { createE2EDatabase, queryRow, queryRows } from './framework/services'

configureE2EFlow()

/**
 * Put the caret at the end of a text leaf. slate-react copies the browser
 * selection into the editor on a 100 ms throttle, and toolbar inserts read the
 * editor's, so the helper waits past the throttle before returning.
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

/** Click into `target` until the caret is inside it, then type there. */
async function typeInto(page: Page, target: Locator, text: string): Promise<void> {
  await expect(async () => {
    await target.click()
    expect(
      await target.evaluate((element) => {
        const anchor = window.getSelection()?.anchorNode
        return Boolean(anchor && element.contains(anchor))
      })
    ).toBe(true)
  }).toPass({ timeout: 20_000 })
  await page.keyboard.type(text)
  await expect(target).toContainText(text)
}

type PostRow = { caption: string; idempotencyKey: string; platform: string; status: string }

async function draftPosts(draftId: string): Promise<PostRow[]> {
  const database = createE2EDatabase()
  try {
    return await queryRows<PostRow>(
      database,
      `SELECT p.caption, p."idempotencyKey", c.platform, p.status::text AS status
       FROM scheduled_post p JOIN channel_connection c ON c.id = p."channelConnectionId"
       WHERE p."contentDraftId" = $1 ORDER BY c.platform`,
      [draftId]
    )
  } finally {
    await database.end()
  }
}

// RFC 037: a hand-written draft, saved, reloaded, checked per channel, and
// scheduled to two channels through the existing scheduler. Posts are queued
// for later, so the Postiz mock only answers the destination checks.
test('a draft is written, saved, scheduled to two channels once, and one post is cancelled', async ({
  browser,
  identity,
  page,
}) => {
  let workspace: DraftWorkspace | null = null
  try {
    workspace = await createDraftWorkspace(identity, page)
    const draftId = await openNewDraft(page)

    await page.getByRole('textbox', { name: 'Draft title' }).fill('Launch day')
    await draftEditor(page).click()
    await page.keyboard.type('Launch day is here. ')
    await page.keyboard.press('ControlOrMeta+b')
    await page.keyboard.type('Shots')
    await page.keyboard.press('ControlOrMeta+b')
    await page.keyboard.type(' writes the posts for you.')
    await expect(
      draftEditor(page).locator('strong, [data-slate-leaf] .font-bold').first()
    ).toHaveText('Shots')

    // The image goes to the workspace's storage through the signed upload.
    await page
      .getByLabel('Insert image')
      .setInputFiles({ buffer: png, mimeType: 'image/png', name: 'launch.png' })
    const image = draftEditor(page).locator('img[src*="/api/v1/assets/"]')
    await expect(image).toBeVisible({ timeout: 30_000 })
    await expectSaved(page)

    await page.reload()
    await expect(draftEditor(page)).toContainText(
      'Launch day is here. Shots writes the posts for you.',
      {
        timeout: 60_000,
      }
    )
    await expect(draftEditor(page).locator('img[src*="/api/v1/assets/"]')).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Draft title' })).toHaveValue('Launch day')

    await page.getByLabel(/^x · /).check()
    await page.getByLabel(/^linkedin · /).check()
    await expect(page.getByTestId('preview-x')).toContainText(
      'Launch day is here. Shots writes the posts for you.'
    )
    await expect(page.getByTestId('preview-x')).toContainText('formatting are removed')

    // Over X's limit: the counter goes red, and scheduling is blocked.
    await draftEditor(page).getByText('for you.').click()
    await page.keyboard.press('End')
    await page.keyboard.type(` ${'x'.repeat(260)}`)
    await expect(page.getByTestId('counter-x')).toHaveText(/^3\d\d \/ 280$/)
    await expect(page.getByTestId('preview-x').getByRole('alert')).toContainText(
      'of 280 characters'
    )
    await expect(page.getByTestId('counter-linkedin')).toHaveText(/ \/ 3000$/)
    await expect(page.getByRole('button', { name: 'Schedule', exact: true })).toBeDisabled()

    // Fix it: delete what was added, as the writer would. Count from the
    // counter, so a keystroke the browser dropped under load cannot skew it.
    const counted = async () =>
      Number((await page.getByTestId('counter-x').textContent())?.split(' / ')[0])
    await expect(async () => {
      const extra = (await counted()) - 51
      for (let index = 0; index < extra; index += 1) await page.keyboard.press('Backspace')
      expect(await counted()).toBe(51)
    }).toPass({ timeout: 30_000 })
    await expect(page.getByTestId('counter-x')).toHaveText('51 / 280')
    await expectSaved(page)

    await page.getByRole('button', { name: 'Schedule', exact: true }).click()
    // Bold is dropped on plain-text channels, so the composer asks first.
    await expect(page.getByRole('alert').filter({ hasText: 'Some content changes' })).toBeVisible()
    await page.getByRole('button', { name: 'Schedule anyway' }).click()
    await expect(page.getByTestId('draft-post')).toHaveCount(2, { timeout: 30_000 })
    await expect(page.getByTestId('draft-post').filter({ hasText: 'SCHEDULED' })).toHaveCount(2)

    const posts = await draftPosts(draftId)
    expect(posts.map(({ caption, platform, status }) => ({ caption, platform, status }))).toEqual([
      {
        caption: 'Launch day is here. Shots writes the posts for you.',
        platform: 'linkedin',
        status: 'SCHEDULED',
      },
      {
        caption: 'Launch day is here. Shots writes the posts for you.',
        platform: 'x',
        status: 'SCHEDULED',
      },
    ])

    // A double submit of the same version replays; it never queues duplicates.
    const version = Number(posts[0].idempotencyKey.split(':v').pop())
    const replay = await apiRequest(page, `/api/v1/content-drafts/${draftId}/schedule`, {
      body: {
        channelConnectionIds: Object.values(workspace.channels),
        scheduledFor: new Date(Date.now() + 86_400_000).toISOString(),
        version,
      },
      method: 'POST',
    })
    expect(replay.status, JSON.stringify(replay.body)).toBe(200)
    expect(replay.body).toMatchObject({ created: false })
    expect(await draftPosts(draftId)).toHaveLength(2)

    // Another workspace cannot read the draft or its posts.
    const stranger = await browser.newContext()
    try {
      const strangerPage = await stranger.newPage()
      await createPublishingWorkspace(
        {
          ...identity,
          email: `other-${identity.email}`,
          workspaceName: `Other ${identity.workspaceName}`,
        },
        strangerPage
      )
      expect((await apiRequest(strangerPage, `/api/v1/content-drafts/${draftId}`)).status).toBe(404)
      expect(
        (await apiRequest(strangerPage, `/api/v1/content-drafts/${draftId}/posts`)).status
      ).toBe(404)
    } finally {
      await stranger.close()
    }

    await page
      .getByTestId('draft-post')
      .filter({ hasText: 'x ·' })
      .getByRole('button', { name: 'Cancel' })
      .click()
    await expect(page.getByTestId('draft-post').filter({ hasText: 'CANCELLED' })).toHaveCount(1)
    const database = createE2EDatabase()
    try {
      expect(
        await queryRow(
          database,
          `SELECT p.status::text AS status FROM scheduled_post p JOIN channel_connection c
           ON c.id = p."channelConnectionId" WHERE p."contentDraftId" = $1 AND c.platform = 'x'`,
          [draftId]
        )
      ).toEqual({ status: 'CANCELLED' })
    } finally {
      await database.end()
    }
  } finally {
    await workspace?.provider.close()
    await unbindTestGoOrganization(workspace?.organizationId ?? null)
  }
})

// Tables, math and footnotes are kept by the editor, survive a reload, and
// each serializes into the channel preview as plain text.
test('a table, a math block and a footnote persist and serialize into the preview', async ({
  identity,
  page,
}) => {
  let workspace: DraftWorkspace | null = null
  try {
    workspace = await createDraftWorkspace(identity, page, ['linkedin'])
    await openNewDraft(page)
    await draftEditor(page).click()
    await page.keyboard.type('Pricing')

    // Blocks insert after the block holding the caret.
    await caretAtEndOf(page, draftEditor(page).getByText('Pricing', { exact: true }))
    await page.getByRole('button', { name: 'Math', exact: true }).click()
    await page.getByPlaceholder(/f\(x\) =/).fill('E = mc^2')
    await page.getByRole('button', { name: 'Done' }).click()
    await expect(draftEditor(page).locator('.katex').first()).toBeVisible()

    await caretAtEndOf(page, draftEditor(page).getByText('Pricing', { exact: true }))
    await page.getByRole('button', { name: 'Table', exact: true }).click()
    const cells = draftEditor(page).locator('td')
    await typeInto(page, cells.nth(0), 'Plan')
    await typeInto(page, cells.nth(1), 'Price')

    // The footnote marker goes at the caret, at the end of the word.
    await caretAtEndOf(page, draftEditor(page).getByText('Pricing', { exact: true }))
    await page.getByRole('button', { name: 'Footnote', exact: true }).click()
    await page.keyboard.type('Prices exclude tax.')
    await expectSaved(page)

    const expectPreview = async () => {
      const preview = page.getByTestId('preview-linkedin')
      await expect(preview).toContainText('Pricing[1]')
      await expect(preview).toContainText(/Plan +\| Price/)
      await expect(preview).toContainText('E = mc^2')
      await expect(preview).toContainText('[1] Prices exclude tax.')
      await expect(preview).toContainText('Tables are posted as aligned text rows.')
      await expect(preview).toContainText('Math is posted as its LaTeX source.')
      await expect(preview).toContainText('Footnotes become numbered notes at the end.')
    }
    await page.getByLabel(/^linkedin · /).check()
    await expectPreview()
    await expectSaved(page)

    await page.reload()
    await expect(draftEditor(page).locator('table')).toContainText('Plan', { timeout: 60_000 })
    await expect(draftEditor(page).locator('.katex').first()).toBeVisible()
    await expect(draftEditor(page)).toContainText('Prices exclude tax.')
    await expectPreview()
  } finally {
    await workspace?.provider.close()
    await unbindTestGoOrganization(workspace?.organizationId ?? null)
  }
})

// Comment threads are saved with the draft, so a reload still shows them.
test('a comment thread survives a reload', async ({ identity, page }) => {
  let workspace: DraftWorkspace | null = null
  try {
    workspace = await createDraftWorkspace(identity, page, ['linkedin'])
    await openNewDraft(page)
    await draftEditor(page).click()
    await page.keyboard.type('Launch day')
    await draftEditor(page).getByText('Launch day', { exact: true }).selectText()
    await page.getByRole('button', { name: 'Comment', exact: true }).click()
    await page.getByPlaceholder('Reply...').click()
    await page.keyboard.type('Check the date')
    await page.keyboard.press('Enter')
    await expect(page.getByText('Check the date')).toBeVisible()
    await expectSaved(page)

    await page.reload()
    await draftEditor(page).getByText('Launch day', { exact: true }).click({ timeout: 60_000 })
    await expect(page.getByText('Check the date')).toBeVisible()
  } finally {
    await workspace?.provider.close()
    await unbindTestGoOrganization(workspace?.organizationId ?? null)
  }
})

// DOCX and Markdown in and out. Imported images are stored as workspace
// assets, not left inline; the exported Word file opens and holds the text.
test('a draft imports and exports DOCX and Markdown', async ({ identity, page }) => {
  await createPublishingWorkspace(identity, page)
  const draftId = await openNewDraft(page)

  const docx = await buildDocx('Quarterly launch notes', png)
  await page.getByLabel('Import DOCX').setInputFiles({
    buffer: docx,
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    name: 'launch.docx',
  })
  await expect(draftEditor(page)).toContainText('Quarterly launch notes', { timeout: 30_000 })
  await expect(draftEditor(page).locator('img[src*="/api/v1/assets/"]')).toBeVisible({
    timeout: 30_000,
  })

  await page.getByLabel('Import Markdown').setInputFiles({
    buffer: Buffer.from('## Highlights\n\n- Faster exports\n- Shared drafts\n'),
    mimeType: 'text/markdown',
    name: 'notes.md',
  })
  await expect(draftEditor(page).locator('h2')).toHaveText('Highlights')
  await expect(draftEditor(page)).toContainText('Shared drafts')
  await expectSaved(page)

  const database = createE2EDatabase()
  try {
    const stored = await queryRow<{ assetIds: string[]; body: string }>(
      database,
      'SELECT "assetIds", body::text AS body FROM content_draft WHERE id = $1',
      [draftId]
    )
    expect(stored?.assetIds).toHaveLength(1)
    expect(stored?.body).not.toContain('data:image')
    expect(
      await queryRow(database, `SELECT status::text AS status FROM asset WHERE id = $1`, [
        stored?.assetIds[0],
      ])
    ).toEqual({ status: 'UPLOADED' })
  } finally {
    await database.end()
  }

  const [wordFile] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export DOCX' }).click(),
  ])
  expect(wordFile.suggestedFilename()).toMatch(/\.docx$/)
  const exported = await JSZip.loadAsync(await readFile((await wordFile.path()) ?? ''))
  expect(await exported.file('word/document.xml')?.async('text')).toContain(
    'Quarterly launch notes'
  )

  const [markdownFile] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export Markdown' }).click(),
  ])
  const markdown = await readFile((await markdownFile.path()) ?? '', 'utf8')
  expect(markdown).toContain('Quarterly launch notes')
  expect(markdown).toContain('## Highlights')
})
