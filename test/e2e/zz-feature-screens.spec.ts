// Temporary: screenshots of the 20 drafts enhancements. Not committed.
import { mkdir } from 'node:fs/promises'
import { expect, type Locator, type Page } from '@playwright/test'
import {
  chooseChannels,
  createDraftWorkspace,
  draftEditor,
  openNewDraft,
  openSchedule,
} from './framework/content-drafts'
import { configureE2EFlow, test } from './framework/flow'
import {
  e2eSecretReference,
  getActiveOrganizationId,
  trpcMutation,
  unbindTestGoOrganization,
} from './framework/publishing'
import { createE2EDatabase, grantWorkspacePlan, queryRow, queryRows } from './framework/services'

configureE2EFlow()
test.use({ viewport: { height: 900, width: 1440 } })

const OUT = '.context/screens'
const failures: string[] = []
const only = process.env.SHOTS_ONLY?.split(',')

async function step(page: Page, name: string, run: () => Promise<void>): Promise<void> {
  if (only && !only.includes(name)) return
  try {
    await run()
    console.log(`ok   ${name}`)
  } catch (error) {
    const text = error instanceof Error ? error.message.split('\n').slice(0, 4).join(' | ') : String(error)
    failures.push(`${name}: ${text}`)
    console.log(`FAIL ${name}: ${text}`)
    await page.screenshot({ path: `${OUT}/FAILED-${name}.png` }).catch(() => {})
    await page.keyboard.press('Escape').catch(() => {})
    await page.keyboard.press('Escape').catch(() => {})
  }
}

// The local dev server recompiles routes as it goes; give saves room.
async function saved(page: Page): Promise<void> {
  await expect(page.getByTestId('save-state')).toHaveText('Saved', { timeout: 90_000 })
}

async function shot(page: Page, name: string, target?: Locator): Promise<void> {
  await page.waitForTimeout(600)
  if (target) await target.screenshot({ path: `${OUT}/${name}.png` })
  else await page.screenshot({ path: `${OUT}/${name}.png` })
}

async function untilPosted(page: Page, suffix: string, act: () => Promise<void>): Promise<void> {
  let sent = false
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith(suffix)) sent = true
  })
  await expect(async () => {
    if (!sent) await act()
    await expect.poll(() => sent, { timeout: 2_000 }).toBe(true)
  }).toPass({ timeout: 60_000 })
}

async function newPost(page: Page, text: string): Promise<void> {
  await page.waitForTimeout(300)
  await page.keyboard.press('ControlOrMeta+Enter')
  await page.waitForTimeout(300)
  await page.keyboard.type(text)
}

test('screenshots of the drafts enhancements', async ({ browser, identity, page }) => {
  test.setTimeout(45 * 60_000)
  await mkdir(OUT, { recursive: true })
  // Clean shots: hide the dev overlay, but log what it would report.
  const hideOverlay = () =>
    document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style')
      style.textContent = 'nextjs-portal { display: none !important; }'
      document.head.append(style)
    })
  await page.context().addInitScript(hideOverlay)
  page.on('console', (message) => {
    if (message.type() === 'error') console.log(`console error: ${message.text().slice(0, 400)}`)
  })
  page.on('pageerror', (error) => console.log(`page error: ${error.message.slice(0, 3000)}`))
  // Pro holds three channels: connect three, move to Business, add the rest.
  // The Postiz mock lists this same array, so it answers for all five.
  const channels = ['x', 'linkedin', 'threads']
  const workspace = await createDraftWorkspace(identity, page, channels)
  try {
    await grantWorkspacePlan(await getActiveOrganizationId(page), 'business')
    for (const platform of ['bluesky', 'mastodon']) {
      channels.push(platform)
      const response = await trpcMutation(page, 'channelConnection.create', {
        externalAccountId: `postiz-${platform}`,
        platform,
        secretReference: e2eSecretReference,
      })
      expect(response.status, JSON.stringify(response.body)).toBe(200)
    }
    // A first draft gives the composer handles and hashtags to suggest.
    await openNewDraft(page)
    await draftEditor(page).click()
    // One input event, so the @ picker does not open and swallow the text.
    await page.keyboard.insertText('Thanks @vercel and @nextjs for the launch help #shipit #buildinpublic')
    await saved(page)

    // The main draft: a three-post thread with a link.
    const mainDraft = await openNewDraft(page)
    await page.getByRole('textbox', { name: 'Draft title' }).fill('Shots 2.0 launch')

    await step(page, '12a-hashtag-chips', async () => {
      await draftEditor(page).click()
      await expect(page.getByRole('button', { name: '#shipit' })).toBeVisible()
      await shot(page, '12a-hashtag-chips')
    })
    await step(page, '12b-mention-picker', async () => {
      await draftEditor(page).click()
      await page.keyboard.type('@')
      await expect(page.getByText('vercel').first()).toBeVisible()
      await shot(page, '12b-mention-picker')
      await page.keyboard.press('Escape')
      await page.keyboard.press('ControlOrMeta+a')
      await page.keyboard.press('Backspace')
      await expect(draftEditor(page)).not.toContainText('@')
    })

    await draftEditor(page).click()
    await page.keyboard.type(
      'We just shipped Shots 2.0: the fastest way to turn screenshots into posts. https://nextjs.org'
    )
    await newPost(page, 'What is new: a posting queue, a calendar, approvals and share links.')
    await newPost(page, 'Try it today and tell us what you think. #shipit')
    await saved(page)

    await step(page, '10-per-post-tools', async () => {
      await page.getByTestId('post-header').nth(1).hover()
      await expect(page.getByRole('button', { name: 'Move post 2 up' })).toBeVisible()
      await shot(page, '10-per-post-tools')
    })

    await step(page, '04-19-channel-picker', async () => {
      await page.getByRole('button', { name: 'Channels' }).click()
      for (const platform of channels) {
        await page.getByLabel(new RegExp(`^${platform} · `)).check()
      }
      await shot(page, '04-account-names-and-19-new-channels')
      await page.keyboard.press('Escape')
      await saved(page)
    })

    await step(page, 'previews', async () => {
      await page.getByRole('button', { name: 'Preview' }).click()
      const x = page.getByTestId('preview-x')
      await expect(x).toBeVisible()
      await page
        .getByTestId('link-card')
        .first()
        .waitFor({ timeout: 30_000 })
        .catch(() => console.log('no link card'))
      await shot(page, '19b-channel-previews')
      await shot(page, '13-x-counting-and-12c-link-card', x)
      for (const channel of ['threads', 'bluesky', 'mastodon']) {
        const preview = page.getByTestId(`preview-${channel}`)
        await preview.scrollIntoViewIfNeeded()
        await shot(page, `19c-preview-${channel}`, preview)
      }
      const linkedin = page.getByTestId('preview-linkedin')
      await linkedin.scrollIntoViewIfNeeded()
      await linkedin.getByRole('button', { name: 'Write it differently for LinkedIn' }).click()
      await linkedin
        .getByLabel('LinkedIn text')
        .fill(
          'Shots 2.0 is out. For teams that post every day, it adds a posting queue, a calendar, approvals and share links for feedback.'
        )
      await shot(page, '09-per-channel-text', linkedin)
      await page.keyboard.press('Escape')
      await saved(page)
    })

    await step(page, '11-ai-actions', async () => {
      await page.getByRole('button', { name: 'AI help' }).click()
      await expect(page.getByRole('menuitem', { name: 'Turn into a thread' })).toBeVisible()
      await shot(page, '11-ai-actions')
      await page.keyboard.press('Escape')
    })

    await step(page, '18-history', async () => {
      await page.getByRole('button', { name: 'History' }).click()
      await expect(page.getByTestId('revision').first()).toBeVisible({ timeout: 30_000 })
      await shot(page, '18-history')
      await page.keyboard.press('Escape')
    })

    let link = ''
    await step(page, '17a-share-link', async () => {
      await page.getByRole('button', { name: 'Share', exact: true }).first().click()
      await page.getByLabel('Share link').click()
      await expect(page.getByLabel('Link to share')).toBeVisible({ timeout: 60_000 })
      link = await page.getByLabel('Link to share').inputValue()
      await shot(page, '17a-share-link')
      await page.keyboard.press('Escape')
    })
    await step(page, '17b-guest-page', async () => {
      const guest = await browser.newContext({ viewport: { height: 900, width: 1440 } })
      await guest.addInitScript(hideOverlay)
      try {
        const guestPage = await guest.newPage()
        await guestPage.goto(link)
        await untilPosted(guestPage, '/comments', async () => {
          await guestPage.getByLabel('Your name').fill('Ana from marketing')
          await guestPage
            .getByLabel('Your comment')
            .fill('Lead with the price in the first post, and the thread is perfect.')
          await guestPage.getByRole('button', { name: 'Send comment' }).click()
        })
        try {
          await expect(guestPage.getByRole('listitem').first()).toBeVisible({ timeout: 60_000 })
        } catch (error) {
          await guestPage.screenshot({ path: `${OUT}/FAILED-17b-guest-only.png` })
          throw error
        }
        await shot(guestPage, '17b-guest-share-page')
      } finally {
        await guest.close()
      }
      await page.goto(page.url())
      const comments = page.getByTestId('guest-comments')
      await expect(comments).toBeVisible({ timeout: 60_000 })
      await comments.scrollIntoViewIfNeeded()
      await shot(page, '17c-guest-comments-in-composer')
    })

    await step(page, 'schedule-dialog', async () => {
      const dialog = await openSchedule(page)
      await expect(dialog.getByText('Best times')).toBeVisible({ timeout: 30_000 })
      await shot(page, '05a-add-to-queue-and-07-best-times')
      await dialog.getByLabel('When, in words').fill('tomorrow 9am')
      await expect(dialog.getByTestId('when-reading')).toContainText('9:00')
      await shot(page, '08-natural-language-time')
      await dialog.getByText('X extras: follow-ups and a poll').click()
      await dialog.getByLabel('Repost at likes').fill('25')
      await dialog.getByLabel('Auto reply at likes').fill('50')
      await dialog.getByLabel('Auto reply text').fill('Thanks for the love! Try it free at shots.app')
      await dialog.getByLabel('Quote after hours').fill('24')
      await dialog.getByLabel('Quote text').fill('In case you missed it yesterday:')
      await dialog.getByLabel('Repost at likes').scrollIntoViewIfNeeded()
      await shot(page, '15-auto-actions')
      await dialog.getByRole('button', { name: 'Add a poll' }).click()
      await dialog.getByLabel('Poll choice 1').fill('Queue')
      await dialog.getByLabel('Poll choice 2').fill('Calendar')
      await dialog.getByRole('button', { name: '+ Choice' }).click()
      await dialog.getByLabel('Poll choice 3').fill('Approvals')
      await dialog.getByLabel('Poll length').scrollIntoViewIfNeeded()
      await shot(page, '20a-x-poll')
      await dialog
        .getByRole('button', { name: /^Schedule/ })
        .last()
        .click()
      await expect(page.getByTestId('draft-post')).toHaveCount(5, { timeout: 60_000 })
      await page.getByTestId('draft-post').first().scrollIntoViewIfNeeded()
      await shot(page, '05b-scheduled-posts-per-channel')
    })

    // The queue: one more draft takes the next free slot.
    await step(page, '05c-queue-tab', async () => {
      await openNewDraft(page)
      await draftEditor(page).click()
      await page.keyboard.type('Behind the scenes: how we built the posting queue.')
      await chooseChannels(page, ['x', 'linkedin'])
      await saved(page)
      const dialog = await openSchedule(page)
      await dialog.getByRole('button', { name: 'Add to queue' }).click()
      await expect(page.getByTestId('draft-post')).toHaveCount(2, { timeout: 60_000 })
      await page.getByRole('tab', { name: /Queue/ }).click()
      await expect(page.getByTestId('queue-item').first()).toBeVisible()
      await shot(page, '05c-queue-tab')
    })

    await step(page, '06-calendar', async () => {
      const tomorrow = new Date(Date.now() + 86_400_000)
      const pad = (value: number) => String(value).padStart(2, '0')
      await page.goto(
        `/drafts/calendar?week=${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}`
      )
      await expect(page.getByTestId('calendar-post').first()).toBeVisible({ timeout: 60_000 })
      await shot(page, '06-calendar')
    })

    // A live thread whose last reply failed, with engagement read.
    await step(page, '01-14-live-post', async () => {
      const liveDraft = await openNewDraft(page)
      await page.getByRole('textbox', { name: 'Draft title' }).fill('Launch recap')
      await draftEditor(page).click()
      await page.keyboard.type('Launch week recap: 1,200 signups in five days.')
      await newPost(page, 'The queue was the most used feature by far.')
      await newPost(page, 'Next up: Threads, Bluesky and Mastodon analytics.')
      await chooseChannels(page, ['x'])
      await saved(page)
      await (await openSchedule(page)).getByRole('button', { name: 'Schedule', exact: true }).click()
      await expect(page.getByTestId('draft-post')).toHaveCount(1, { timeout: 60_000 })
      const database = createE2EDatabase()
      try {
        const [post] = await queryRows<{ id: string }>(
          database,
          `SELECT id FROM scheduled_post WHERE "contentDraftId" = $1`,
          [liveDraft]
        )
        await queryRow(
          database,
          `UPDATE scheduled_post SET status = 'PUBLISHED', "remotePostId" = '1846000000000000001',
             "threadProgress" = '{"posted":1,"total":2,"lastReplyId":"1846000000000000002"}'::jsonb,
             metrics = '{"likes":412,"reposts":58,"replies":37,"impressions":18950}'::jsonb,
             "metricsAt" = now()
           WHERE id = $1 RETURNING id`,
          [post.id]
        )
      } finally {
        await database.end()
      }
      await page.goto(page.url())
      await expect(draftEditor(page)).toContainText('Launch week recap', { timeout: 60_000 })
      const live = page.getByTestId('draft-post')
      await expect(live).toContainText('1 of 2 replies went out.', { timeout: 60_000 })
      await live.scrollIntoViewIfNeeded()
      await shot(page, '01-thread-resume-and-14a-engagement')
      await page.getByRole('tab', { name: /Posted/ }).click()
      await shot(page, '14b-posted-tab')
    })

    await step(page, '20b-video', async () => {
      await openNewDraft(page)
      await draftEditor(page).click()
      await page.keyboard.type('A 1-second product teaser. The video goes out alone.')
      const webm = await page.evaluate(async () => {
        const canvas = document.createElement('canvas')
        canvas.width = 640
        canvas.height = 360
        const context = canvas.getContext('2d')!
        const recorder = new MediaRecorder(canvas.captureStream(30), { mimeType: 'video/webm' })
        const chunks: Blob[] = []
        recorder.ondataavailable = (event) => chunks.push(event.data)
        recorder.start()
        for (let frame = 0; frame < 30; frame++) {
          context.fillStyle = `hsl(${frame * 12}, 80%, 50%)`
          context.fillRect(0, 0, 640, 360)
          context.fillStyle = 'white'
          context.font = 'bold 64px sans-serif'
          context.fillText('Shots 2.0', 170, 200)
          await new Promise((resolve) => setTimeout(resolve, 33))
        }
        const stopped = new Promise((resolve) => (recorder.onstop = resolve))
        recorder.stop()
        await stopped
        return Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()))
      })
      await page.getByLabel('Insert image').setInputFiles({
        buffer: Buffer.from(webm),
        mimeType: 'video/webm',
        name: 'teaser.webm',
      })
      await expect(draftEditor(page).locator('video, iframe').first()).toBeVisible({
        timeout: 60_000,
      })
      await saved(page)
      await shot(page, '20b-video-in-editor')
    })

    // Approvals: required in settings, then asked for and given.
    await step(page, '05d-16-settings', async () => {
      await page.goto('/drafts/settings')
      await page.getByLabel('Require approval').check()
      await shot(page, '05d-queue-slots-and-16-require-approval')
      await page.getByRole('button', { name: 'Save settings' }).click()
      await expect(page.getByText('Saved.')).toBeVisible()
    })
    await step(page, '16-approvals', async () => {
      await openNewDraft(page)
      await draftEditor(page).click()
      await page.keyboard.type('Pricing update: the Pro plan now includes the posting queue.')
      await chooseChannels(page, ['x', 'linkedin'])
      await saved(page)
      const blocked = await openSchedule(page)
      await expect(blocked.getByRole('alert').filter({ hasText: 'approves drafts' })).toBeVisible()
      await shot(page, '16a-schedule-blocked-until-approved')
      await blocked.getByRole('button', { name: 'Keep editing' }).click()
      const review = page.getByRole('button', { name: 'Review', exact: true })
      await review.click()
      await shot(page, '16b-ask-for-review')
      await page.getByRole('button', { name: 'Ask for review' }).click()
      await expect(review).toContainText('In review')
      await page.keyboard.press('Escape')
      await review.click()
      await page.getByLabel('Review note').fill('Looks good, ship it.')
      await shot(page, '16c-approve-or-request-changes')
      await page.getByRole('button', { name: 'Approve' }).click()
      await expect(review).toContainText('Approved')
      await page.keyboard.press('Escape')
      await shot(page, '16d-approved')
    })

    await step(page, '04b-connections', async () => {
      await page.goto('/workspace/channels')
      await expect(page.getByText('@shots_x').first()).toBeVisible({ timeout: 60_000 })
      await shot(page, '04b-connected-accounts')
    })

    await step(page, '03-phone-comment', async () => {
      await page.setViewportSize({ height: 844, width: 390 })
      await openNewDraft(page)
      await draftEditor(page).click()
      await page.keyboard.type('Launch day is tomorrow at 9am.')
      await draftEditor(page).getByText('Launch day is tomorrow at 9am.', { exact: true }).selectText()
      await page.waitForTimeout(300)
      await page.keyboard.press('ControlOrMeta+Shift+M')
      await expect(page.getByText('Reply...')).toBeInViewport()
      await shot(page, '03-phone-comment')
    })

    console.log(`main draft ${mainDraft}`)
    console.log(`failures:\n${failures.join('\n') || 'none'}`)
  } finally {
    await workspace.provider.close()
    await unbindTestGoOrganization(workspace.organizationId)
  }
})
