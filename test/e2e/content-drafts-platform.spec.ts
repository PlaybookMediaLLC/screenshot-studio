import { expect, type Page } from '@playwright/test'
import {
  chooseChannels,
  createDraftWorkspace,
  type DraftWorkspace,
  draftEditor,
  expectSaved,
  inPreview,
  openNewDraft,
  openSchedule,
} from './framework/content-drafts'
import { configureE2EFlow, test } from './framework/flow'
import { apiRequest, unbindTestGoOrganization } from './framework/publishing'
import { createE2EDatabase, queryRow, queryRows } from './framework/services'

configureE2EFlow()

// RFC 037, round two: the posting surface around the composer. Posts are
// scheduled for later and live state is set in the database, so nothing is
// published to a network.

type PostRow = {
  assetIds: unknown
  autoActions: unknown
  caption: string
  id: string
  poll: unknown
  replies: unknown
  replyTo: string | null
  scheduledFor: Date
  status: string
}

async function draftPosts(draftId: string): Promise<PostRow[]> {
  const database = createE2EDatabase()
  try {
    return await queryRows<PostRow>(
      database,
      // scheduledFor is stored as UTC without a zone: read it as UTC, not local time.
      `SELECT id, caption, status::text AS status, ("scheduledFor" AT TIME ZONE 'UTC') AS "scheduledFor",
              "assetIds", replies, "replyTo",
              "autoActions", poll
       FROM scheduled_post WHERE "contentDraftId" = $1 ORDER BY "createdAt"`,
      [draftId]
    )
  } finally {
    await database.end()
  }
}

async function write(page: Page, text: string): Promise<void> {
  await draftEditor(page).click()
  await page.keyboard.type(text)
  await expectSaved(page)
}

/**
 * Repeats `act` until it sends a POST to a path ending in `suffix`. On a cold
 * route the markup paints before React hydrates, and an early drag or click
 * is dropped silently (a form even submits natively), so the request itself
 * is the proof the action landed.
 */
async function untilPosted(page: Page, suffix: string, act: () => Promise<void>): Promise<void> {
  let sent = false
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith(suffix)) {
      sent = true
    }
  })
  await expect(async () => {
    if (!sent) await act()
    await expect.poll(() => sent, { timeout: 2_000 }).toBe(true)
  }).toPass({ timeout: 60_000 })
}

async function withWorkspace(
  identity: Parameters<typeof createDraftWorkspace>[0],
  page: Page,
  platforms: string[],
  run: (workspace: DraftWorkspace) => Promise<void>
): Promise<void> {
  let workspace: DraftWorkspace | null = null
  try {
    workspace = await createDraftWorkspace(identity, page, platforms)
    await run(workspace)
  } finally {
    await workspace?.provider.close()
    await unbindTestGoOrganization(workspace?.organizationId ?? null)
  }
}

test('the queue takes the next slot, and the calendar moves a post to another day', async ({
  identity,
  page,
}) => {
  await withWorkspace(identity, page, ['x'], async () => {
    // The account shows as its platform names it, not an integration id.
    const draftId = await openNewDraft(page)
    await page.getByRole('button', { name: 'Channels' }).click()
    await expect(page.getByRole('dialog')).toContainText('@shots_x')
    await page.keyboard.press('Escape')
    await write(page, 'Queued for the next slot')
    await chooseChannels(page, ['x'])
    await expectSaved(page)

    const dialog = await openSchedule(page)
    await expect(dialog.getByText('Best times')).toBeVisible()
    await dialog.getByRole('button', { name: 'Add to queue' }).click()
    await expect(page.getByTestId('draft-post')).toHaveCount(1, { timeout: 30_000 })
    const [queued] = await draftPosts(draftId)
    // The default slots: weekdays at 9:00 in the workspace's time zone.
    expect(queued.status).toBe('SCHEDULED')
    const { timeZone } = (await apiRequest(page, '/api/v1/content-draft-settings')).body as {
      timeZone: string
    }
    const inZone = (options: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat('en-US', { ...options, timeZone }).format(
        new Date(queued.scheduledFor)
      )
    expect(inZone({ hour: 'numeric', hourCycle: 'h23', minute: '2-digit' })).toBe('09:00')
    expect(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']).toContain(inZone({ weekday: 'short' }))

    await page.getByRole('tab', { name: /Queue/ }).click()
    await expect(page.getByTestId('queue-item')).toContainText('Queued for the next slot')

    // A second draft at a set time, moved on the calendar by a day.
    const second = await openNewDraft(page)
    await write(page, 'Moved on the calendar')
    await chooseChannels(page, ['x'])
    await expectSaved(page)
    const at = new Date(Date.now() + 3 * 86_400_000)
    at.setHours(10, 0, 0, 0)
    const pad = (value: number) => String(value).padStart(2, '0')
    const local = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T10:00`
    const scheduleDialog = await openSchedule(page)
    await scheduleDialog.getByLabel('Schedule time').fill(local)
    await scheduleDialog.getByRole('button', { name: 'Schedule', exact: true }).click()
    await expect(page.getByTestId('draft-post')).toHaveCount(1, { timeout: 30_000 })

    await page.goto(`/drafts/calendar?week=${local.slice(0, 10)}`)
    const card = page.getByTestId('calendar-post').filter({ hasText: 'Moved on the calendar' })
    await expect(card).toBeVisible()
    // The next day, or the day before when it is the week's last.
    const target = new Date(at)
    target.setDate(at.getDate() + (at.getDay() === 0 ? -1 : 1))
    await untilPosted(page, '/move', () =>
      card.dragTo(page.getByTestId(`calendar-day-${target.getDate()}`))
    )
    await expect(page.getByText(/Moved to/)).toBeVisible({ timeout: 20_000 })
    const posts = await draftPosts(second)
    expect(posts.map((post) => post.status)).toEqual(['CANCELLED', 'SCHEDULED'])
    expect(new Date(posts[1].scheduledFor).getDate()).toBe(target.getDate())
  })
})

test('a draft waits for approval, and an edit after approval needs another', async ({
  identity,
  page,
}) => {
  await withWorkspace(identity, page, ['x'], async () => {
    await page.goto('/drafts/settings')
    await page.getByLabel('Require approval').check()
    await page.getByRole('button', { name: 'Save settings' }).click()
    await expect(page.getByText('Saved.')).toBeVisible()

    const draftId = await openNewDraft(page)
    await write(page, 'Needs a second pair of eyes')
    await chooseChannels(page, ['x'])
    await expectSaved(page)
    const blocked = await openSchedule(page)
    await expect(blocked.getByRole('alert').filter({ hasText: 'approves drafts' })).toBeVisible()
    await expect(blocked.getByRole('button', { name: 'Schedule', exact: true })).toBeDisabled()
    await blocked.getByRole('button', { name: 'Keep editing' }).click()

    await page.getByRole('button', { name: 'Review', exact: true }).click()
    await page.getByRole('button', { name: 'Ask for review' }).click()
    await expect(page.getByRole('button', { name: 'Review', exact: true })).toContainText(
      'In review'
    )
    // A publisher (here the owner) answers from the same control.
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Review', exact: true }).click()
    await page.getByLabel('Review note').fill('Ship it')
    await page.getByRole('button', { name: 'Approve' }).click()
    await expect(page.getByRole('button', { name: 'Review', exact: true })).toContainText(
      'Approved'
    )
    await page.keyboard.press('Escape')

    const dialog = await openSchedule(page)
    await dialog.getByRole('button', { name: 'Schedule', exact: true }).click()
    await expect(page.getByTestId('draft-post')).toHaveCount(1, { timeout: 30_000 })
    expect(await draftPosts(draftId)).toHaveLength(1)
  })
})

test('a share link lets a guest read the draft and leave a comment', async ({
  browser,
  identity,
  page,
}) => {
  await withWorkspace(identity, page, ['x'], async () => {
    await openNewDraft(page)
    await write(page, 'What do you think of this launch post?')
    await page.getByRole('button', { name: 'Share' }).click()
    // The switch follows the server: it turns on once the link exists.
    await page.getByLabel('Share link').click()
    await expect(page.getByLabel('Link to share')).toBeVisible()
    const link = await page.getByLabel('Link to share').inputValue()
    expect(link).toMatch(/\/d\/[A-Za-z0-9_-]{30,}$/)
    await page.keyboard.press('Escape')

    const guest = await browser.newContext()
    try {
      const guestPage = await guest.newPage()
      await guestPage.goto(link)
      await expect(guestPage.getByTestId('shared-draft')).toContainText(
        'What do you think of this launch post?'
      )
      await untilPosted(guestPage, '/comments', async () => {
        await guestPage.getByLabel('Your name').fill('Ana')
        await guestPage.getByLabel('Your comment').fill('Lead with the price.')
        await guestPage.getByRole('button', { name: 'Send comment' }).click()
      })
      // In the list, not just still in the box: the comment was kept.
      await expect(
        guestPage.getByRole('listitem').filter({ hasText: 'Lead with the price.' })
      ).toBeVisible({ timeout: 60_000 })
    } finally {
      await guest.close()
    }

    await page.goto(page.url())
    await expect(page.getByTestId('guest-comments')).toContainText('Lead with the price.')
    // Off, the link finds nothing.
    await page.getByRole('button', { name: 'Share' }).click()
    await page.getByLabel('Share link').click()
    await expect(page.getByLabel('Link to share')).toHaveCount(0)
    await page.keyboard.press('Escape')
    const offline = await browser.newContext()
    try {
      const response = await (await offline.newPage()).goto(link)
      expect(response?.status()).toBe(404)
    } finally {
      await offline.close()
    }
  })
})

test('writing tools: history, per-post tools, channel text, AI, hashtags and plain-language times', async ({
  identity,
  page,
}) => {
  await withWorkspace(identity, page, ['x', 'linkedin'], async () => {
    // A first draft teaches the composer a hashtag.
    await openNewDraft(page)
    await write(page, 'Launch week #shipit')
    const draftId = await openNewDraft(page)
    await draftEditor(page).click()
    await page.getByRole('button', { name: '#shipit' }).click()
    await expect(draftEditor(page)).toContainText('#shipit')
    await page.keyboard.type(' First post')
    await page.waitForTimeout(300)
    await page.keyboard.press('ControlOrMeta+Enter')
    await page.waitForTimeout(300)
    await page.keyboard.type('Second post')
    await expectSaved(page)
    await expect(page.getByTestId('post-header')).toHaveCount(2)

    // Per-post tools: the second post moves up, then is deleted.
    await page.getByTestId('post-header').nth(1).hover()
    await page.getByRole('button', { name: 'Move post 2 up' }).click()
    // Still two posts, now in the other order.
    await expect(page.getByTestId('post-header')).toHaveCount(2)
    await expect(draftEditor(page)).toHaveText(/^Second post[\s\S]*#shipit First post$/)
    await page.getByTestId('post-header').nth(1).hover()
    await page.getByRole('button', { name: 'Delete post 2' }).click()
    await expect(page.getByTestId('post-header')).toHaveCount(1)
    await expect(draftEditor(page)).not.toContainText('First post')
    await expectSaved(page)

    // History: the first save kept a revision; restoring brings it back.
    await page.getByRole('button', { name: 'History' }).click()
    await expect(page.getByTestId('revision').first()).toBeVisible()
    await page.getByRole('button', { name: 'Restore' }).first().click()
    await expect(page.getByText('Restored.')).toBeVisible({ timeout: 60_000 })
    await expectSaved(page)

    // Channel text: LinkedIn says something longer.
    await chooseChannels(page, ['x', 'linkedin'])
    await inPreview(page, async () => {
      const linkedin = page.getByTestId('preview-linkedin')
      await linkedin.getByRole('button', { name: 'Write it differently for LinkedIn' }).click()
      await linkedin.getByLabel('LinkedIn text').fill('A longer note for LinkedIn readers.')
      await expect(linkedin).toContainText('Own text')
      await expect(linkedin).toContainText('A longer note for LinkedIn readers.')
    })
    await expectSaved(page)

    // AI: the scripted model answers, and the answer replaces the text.
    await page.getByRole('button', { name: 'AI help' }).click()
    await page.getByRole('menuitem', { name: 'Turn into a thread' }).click()
    await expect(draftEditor(page)).toContainText('Done.', { timeout: 30_000 })
    await page.keyboard.press('ControlOrMeta+z')
    await expectSaved(page)

    // Plain-language time, then an X poll, then scheduling.
    const dialog = await openSchedule(page)
    await dialog.getByLabel('When, in words').fill('tomorrow 9am')
    await expect(dialog.getByTestId('when-reading')).toContainText('9:00')
    await dialog.getByText('X extras: follow-ups and a poll').click()
    await dialog.getByLabel('Repost at likes').fill('25')
    await dialog.getByRole('button', { name: 'Add a poll' }).click()
    await dialog.getByLabel('Poll choice 1').fill('Yes')
    await dialog.getByLabel('Poll choice 2').fill('No')
    await dialog
      .getByRole('button', { name: /^Schedule/ })
      .last()
      .click()
    await expect(page.getByTestId('draft-post')).toHaveCount(2, { timeout: 30_000 })
    const posts = await draftPosts(draftId)
    const linkedin = posts.find((post) => post.caption === 'A longer note for LinkedIn readers.')
    const x = posts.find((post) => post !== linkedin)
    expect(linkedin).toBeDefined()
    expect(x?.poll).toEqual({ durationMinutes: 1440, options: ['Yes', 'No'] })
    expect(x?.autoActions).toEqual({ repostAtLikes: 25 })
    expect(new Date(x?.scheduledFor ?? 0).getHours()).toBe(9)
  })
})

test('a live post links to itself, shows engagement, and resumes a thread that stopped', async ({
  identity,
  page,
}) => {
  await withWorkspace(identity, page, ['x'], async () => {
    const draftId = await openNewDraft(page)
    await write(page, 'One')
    await page.keyboard.press('ControlOrMeta+Enter')
    await page.waitForTimeout(300)
    await page.keyboard.type('Two')
    await page.keyboard.press('ControlOrMeta+Enter')
    await page.waitForTimeout(300)
    await page.keyboard.type('Three')
    await chooseChannels(page, ['x'])
    await expectSaved(page)
    await (await openSchedule(page)).getByRole('button', { name: 'Schedule', exact: true }).click()
    await expect(page.getByTestId('draft-post')).toHaveCount(1, { timeout: 30_000 })

    // As the publisher leaves it when the second reply failed.
    const [post] = await draftPosts(draftId)
    const database = createE2EDatabase()
    try {
      await queryRow(
        database,
        `UPDATE scheduled_post SET status = 'PUBLISHED', "remotePostId" = 'tweet-1',
           "threadProgress" = '{"posted":1,"total":2,"lastReplyId":"tweet-2"}'::jsonb,
           metrics = '{"likes":12,"reposts":3}'::jsonb, "metricsAt" = now()
         WHERE id = $1 RETURNING id`,
        [post.id]
      )
    } finally {
      await database.end()
    }
    await page.reload()
    const live = page.getByTestId('draft-post')
    await expect(live.getByRole('link', { name: 'View post' })).toHaveAttribute(
      'href',
      'https://x.com/i/status/tweet-1'
    )
    await expect(live.getByTestId('metric-likes')).toContainText('12')
    await expect(live).toContainText('1 of 2 replies went out.')
    await live.getByRole('button', { name: 'Post the rest' }).click()
    await expect(page.getByTestId('draft-post')).toHaveCount(2, { timeout: 20_000 })
    const posts = await draftPosts(draftId)
    // It goes out now: here, with no real account behind the channel, it fails.
    expect(posts[1]).toMatchObject({ caption: 'Three', replyTo: 'tweet-2' })
    expect(posts[1].status).not.toBe('CANCELLED')

    // The rail's Posted tab lists the draft.
    await page.getByRole('tab', { name: /Posted/ }).click()
    await expect(page.getByRole('navigation').getByText('1 live', { exact: false })).toBeVisible()
    expect((await apiRequest(page, `/api/v1/content-drafts/${draftId}/revisions`)).status).toBe(200)
  })
})

test('on a phone, a comment opens beside its text', async ({ identity, page }) => {
  await withWorkspace(identity, page, ['x'], async () => {
    await page.setViewportSize({ height: 844, width: 390 })
    await openNewDraft(page)
    await draftEditor(page).click()
    await page.keyboard.type('Launch day')
    await draftEditor(page).getByText('Launch day', { exact: true }).selectText()
    await page.waitForTimeout(300)
    // A phone has no selection toolbar: the shortcut starts the comment.
    await page.keyboard.press('ControlOrMeta+Shift+M')
    const reply = page.getByText('Reply...')
    await expect(reply).toBeInViewport()
    // Not pinned to the window's corner.
    const box = await reply.boundingBox()
    expect(box?.y ?? 0).toBeGreaterThan(80)
  })
})
