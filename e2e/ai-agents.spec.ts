import { signUpAndCreateWorkspace } from './framework/auth'
import { browserRequest } from './framework/browser'
import { configureE2EFlow, expect, test } from './framework/flow'

configureE2EFlow()

test('an owner creates an agent key whose snippets carry it, and the key cannot approve', async ({
  identity,
  page,
}) => {
  await signUpAndCreateWorkspace(identity, page)
  await page.goto('/workspace/ai-agents')

  await expect(page.getByRole('heading', { name: 'MCP server' })).toBeVisible()
  await expect(page.getByLabel('Server URL', { exact: true })).toHaveValue(/\/mcp$/)
  // Agent keys start with read and draft access only.
  await expect(page.getByLabel(/artifact:read/)).toBeChecked()
  await expect(page.getByLabel(/release:create/)).toBeChecked()
  await expect(page.getByLabel(/asset:write/)).not.toBeChecked()
  // Scheduling is opt-in per key.
  await expect(page.getByLabel(/post:schedule/)).not.toBeChecked()

  await page.getByRole('button', { name: 'Create agent key' }).click()
  await expect(page.getByText('Copy this key now')).toBeVisible()
  const key = await page.getByLabel('API key', { exact: true }).inputValue()
  expect(key).toMatch(/^ss_/)

  await page.getByRole('tab', { name: 'Cursor' }).click()
  const snippet = JSON.parse(await page.locator('pre code').first().innerText())
  expect(snippet.mcpServers.shots.headers.Authorization).toBe(`Bearer ${key}`)

  // The key reads the workspace through REST, and a decision stays human-only.
  const campaigns = await browserRequest(page, '/api/v1/campaigns', {
    headers: { 'x-api-key': key },
  })
  expect(campaigns.status).toBe(200)
  const approve = await browserRequest(
    page,
    '/api/v1/campaigns/cl00000000000000000000000/approvals',
    {
      body: JSON.stringify({ decision: 'approve' }),
      headers: { 'content-type': 'application/json', 'x-api-key': key },
      method: 'POST',
    }
  )
  expect(approve.status).toBe(403)
})

test('the consent page refuses an unregistered client without redirecting', async ({
  identity,
  page,
}) => {
  await signUpAndCreateWorkspace(identity, page)
  await page.goto(
    '/oauth/authorize?response_type=code&client_id=unregistered&redirect_uri=https%3A%2F%2Fevil.test%2Fcb&state=s1'
  )
  await expect(page.getByRole('heading', { name: /can’t be approved/ })).toBeVisible()
  expect(page.url()).toContain('/oauth/authorize')
})
