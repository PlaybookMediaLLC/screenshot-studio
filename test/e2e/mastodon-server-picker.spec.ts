import { createPublishingWorkspace, apiRequest } from './framework/publishing'
import { configureE2EFlow, expect, test } from './framework/flow'
import { chooseOption } from './framework/controls'
import { mastodonInstanceSchema } from 'screenshot-studio-backend-sdk'

configureE2EFlow()

test('a public Mastodon server returns a real preview through the authenticated backend', async ({
  identity,
  page,
}) => {
  test.skip(
    process.env.E2E_LIVE_PUBLIC_PREVIEW !== '1',
    'Opt-in public network check; no provider account or credentials are used.'
  )
  await createPublishingWorkspace(identity, page)
  await page.goto('/workspace/social-sets')
  await page.getByRole('button', { name: 'Add social set to your personal workspace' }).click()
  const response = page.waitForResponse((item) =>
    item.url().includes('/api/v1/social-instances/mastodon?server=mastodon.social')
  )
  await page.getByRole('dialog').getByRole('button', { name: 'Mastodon', exact: true }).click()
  const actual = await response
  expect(actual.status()).toBe(200)
  const preview = mastodonInstanceSchema.parse(await actual.json())
  expect(preview.origin).toBe('https://mastodon.social')
  await expect(
    page.getByTestId('mastodon-server-preview').getByText(preview.title, { exact: true })
  ).toBeVisible()
  await page.screenshot({ path: '.context/mastodon-live-preview.png', animations: 'disabled' })
})

test('Mastodon preview follows the chosen server and refuses credentials in the request URL', async ({
  identity,
  page,
}) => {
  await createPublishingWorkspace(identity, page)
  const invalid = await apiRequest(page, '/api/v1/social-instances/mastodon?server=127.0.0.1')
  expect(invalid.status).toBe(400)
  let release = () => {}
  let started = () => {}
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  const requested = new Promise<void>((resolve) => {
    started = resolve
  })
  const requestedServers: string[] = []
  await page.route('**/api/v1/social-instances/mastodon?*', async (route) => {
    const server = new URL(route.request().url()).searchParams.get('server') ?? ''
    requestedServers.push(server)
    if (server === 'fosstodon.org') {
      started()
      await held
    }
    await route.fulfill({
      json: {
        origin: `https://${server}`,
        title: server === 'mastodon.social' ? 'Original community' : 'Changed community',
        description: 'Public fixture server information',
        activeUsers: 27,
      },
    })
  })
  try {
    await page.goto('/workspace/social-sets')
    await page.getByRole('button', { name: 'Add social set to your personal workspace' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: 'Mastodon', exact: true }).click()
    const preview = dialog.getByTestId('mastodon-server-preview')
    await expect(preview.getByText('Original community', { exact: true })).toBeVisible()
    await expect(preview.getByText('27 active users in the past four weeks')).toBeVisible()
    await chooseOption(dialog.getByRole('combobox', { name: 'Mastodon server' }), /^fosstodon.org/)
    await requested
    await expect(preview.getByText('Original community', { exact: true })).toHaveCount(0)
    await expect(preview).toHaveAttribute('aria-busy', 'true')
    const cancelled = page.waitForEvent('requestfailed', (request) =>
      request.url().includes('server=fosstodon.org')
    )
    await chooseOption(dialog.getByRole('combobox', { name: 'Mastodon server' }), /^Custom server/)
    await expect(dialog.getByLabel('Custom server hostname')).toHaveValue('')
    await expect(
      dialog.getByRole('button', { name: 'Connect Mastodon account', exact: true })
    ).toBeDisabled()
    await expect(
      preview.getByText('Enter your server to see its public information.')
    ).toBeVisible()
    await cancelled
    release()
    await dialog
      .getByLabel('Custom server hostname')
      .fill('https://person:private-password@social.example')
    await expect(
      preview.getByText(
        'Enter a public HTTPS server hostname without a path, port, or credentials.'
      )
    ).toBeVisible()
    await dialog.getByLabel('Custom server hostname').fill('social.example')
    await expect(preview.getByText('Changed community', { exact: true })).toBeVisible()
    await expect(preview.getByText('https://social.example', { exact: true })).toBeVisible()
    expect(requestedServers).toEqual(['mastodon.social', 'fosstodon.org', 'social.example'])
    await page.screenshot({ path: '.context/mastodon-server-preview.png', animations: 'disabled' })
  } finally {
    release()
  }
})
