import { configureE2EFlow, expect, test } from './framework/flow'
import { createDraftWorkspace, draftEditor, expectSaved } from './framework/content-drafts'
import { apiRequest, unbindTestGoOrganization } from './framework/publishing'

configureE2EFlow()

test('early typing, reordered post controls, selected comments, and failed saves preserve text', async ({
  identity,
  page,
}) => {
  test.setTimeout(240_000)
  const workspace = await createDraftWorkspace(identity, page)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  try {
    await page.goto('/write')
    // Hold creation so the first keystrokes necessarily precede the route and collab sync.
    await page.route('**/api/v1/content-drafts', async (route) => {
      if (route.request().method() === 'POST')
        await new Promise((resolve) => setTimeout(resolve, 500))
      await route.continue()
    })
    await page.getByTestId('new-draft').first().click()
    const early = page.getByRole('textbox', { name: 'New draft text' })
    await expect(early).toBeFocused()
    await page.keyboard.type('Hello world from QA')
    await page.waitForURL(/\/write\/[a-z0-9]+/)
    const id = new URL(page.url()).pathname.split('/').pop()!
    const editor = draftEditor(page)
    await expect(early).toBeHidden({ timeout: 60_000 })
    await expect(editor).toContainText('Hello world from QA')
    await expectSaved(page)

    const title = '0123456789'.repeat(20)
    await page.getByRole('textbox', { name: 'Draft title', exact: true }).pressSequentially(title)
    await expect(page.getByRole('textbox', { name: 'Draft title', exact: true })).toHaveValue(title)
    await expectSaved(page)
    expect((await apiRequest(page, `/api/v1/content-drafts/${id}`)).body).toMatchObject({ title })

    await page.getByRole('button', { name: 'Add another post', exact: true }).click()
    await editor
      .locator('[data-slate-node="element"]')
      .filter({ has: page.locator('[data-slate-zero-width]') })
      .last()
      .click()
    await page.keyboard.type('Second post with padding')
    await expect(editor).toContainText('Second post with padding')
    await page.getByRole('button', { name: 'Move post 2 up', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Move post 1 up', exact: true })).toBeDisabled()
    await page.getByRole('button', { name: 'Delete post 2', exact: true }).click()
    await expect(editor).not.toContainText('Hello world from QA')
    await expect(editor).toContainText('Second post with padding')

    await editor
      .locator('[data-slate-string]')
      .filter({ hasText: 'padding' })
      .evaluate((element) => {
        const text = element.firstChild!
        const offset = text.textContent!.indexOf('padding')
        const range = document.createRange()
        range.setStart(text, offset)
        range.setEnd(text, offset + 7)
        const selection = window.getSelection()!
        selection.removeAllRanges()
        selection.addRange(range)
      })
    await page.keyboard.press('ControlOrMeta+Shift+m')
    await expect(editor.locator('.slate-comment')).toHaveText('padding')
    await page.keyboard.press('Escape')
    await expectSaved(page)

    let attempts = 0
    await page.route(`**/api/v1/content-drafts/${id}`, async (route) => {
      if (route.request().method() === 'PATCH' && ++attempts === 1) {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: '{"message":"Temporary failure"}',
        })
      } else await route.continue()
    })
    await page
      .getByRole('textbox', { name: 'Draft title', exact: true })
      .fill('Retry keeps this title')
    await expect(page.getByTestId('save-state')).toHaveText('Not saved')
    await expect(page.getByRole('button', { name: 'Retry save', exact: true })).toBeVisible()
    await expectSaved(page)
    expect(attempts).toBeGreaterThanOrEqual(2)
    await page.reload()
    await expect(page.getByRole('textbox', { name: 'Draft title', exact: true })).toHaveValue(
      'Retry keeps this title'
    )
    await expect(editor).toContainText('Second post with padding')
    expect(errors).toEqual([])

    const serverSearches: string[] = []
    page.on('request', (request) => {
      const url = new URL(request.url())
      if (url.searchParams.has('_rsc') && url.searchParams.has('q')) serverSearches.push(url.href)
    })
    const search = page.getByRole('searchbox', { name: 'Search drafts' }).first()
    await search.fill('<b>&amp;')
    await expect(page.getByText('No drafts match these filters.').first()).toBeVisible()
    await search.fill('Retry keeps')
    await expect(
      page.getByTestId('draft-row').filter({ hasText: 'Retry keeps this title' })
    ).toHaveCount(1)
    expect(serverSearches).toEqual([])
    await search.fill('')

    const other = await apiRequest(page, '/api/v1/content-drafts', {
      method: 'POST',
      body: { title: 'Bulk companion' },
    })
    expect(other.status).toBe(201)
    await page.reload()
    await page
      .getByRole('button', { name: 'Actions for Retry keeps this title', exact: true })
      .click()
    await page.getByRole('menuitem', { name: 'Select multiple', exact: true }).click()
    await page
      .getByTestId('draft-row')
      .filter({ hasText: 'Bulk companion' })
      .getByRole('link')
      .click()
    const bulk = page.getByRole('toolbar', { name: 'Selected drafts' })
    await expect(bulk).toContainText('2 selected')
    await bulk.getByRole('button', { name: 'Delete', exact: true }).click()
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Delete drafts', exact: true })
      .click()
    await expect(page).toHaveURL(/\/write(?:\?|$)/)
    await expect(
      page.getByTestId('draft-row').filter({ hasText: 'Retry keeps this title' })
    ).toHaveCount(0)
    await expect(page.getByTestId('draft-row').filter({ hasText: 'Bulk companion' })).toHaveCount(0)
  } finally {
    await workspace.provider.close()
    await unbindTestGoOrganization(workspace.organizationId)
  }
})
