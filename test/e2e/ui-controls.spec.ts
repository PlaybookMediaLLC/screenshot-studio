import { expect, test } from './framework/flow'

test('disclosures and the mobile menu work with the keyboard', async ({ page }) => {
  await page.goto('/landing')
  const question = page.getByRole('button', { name: 'What is Shots?', exact: true })
  const answer = page.getByText('A launch platform for software teams.', { exact: false })
  await expect(question).toHaveAttribute('aria-expanded', 'false')
  await expect(answer).toBeHidden()
  await question.press('Enter')
  await expect(question).toHaveAttribute('aria-expanded', 'true')
  await expect(answer).toBeVisible()
  await question.press('Space')
  await expect(answer).toBeHidden()

  await page.setViewportSize({ width: 390, height: 844 })
  const menu = page.getByRole('button', { name: 'Open menu', exact: true })
  await menu.press('Enter')
  const popover = page.getByRole('dialog')
  await expect(popover.getByRole('link', { name: 'Pricing', exact: true })).toBeVisible()
  await page.screenshot({ path: '.context/ui-migration-mobile-menu.png' })
  await page.keyboard.press('Escape')
  await expect(popover).toBeHidden()
  await expect(menu).toBeFocused()
})
