import { expect, type Locator } from '@playwright/test'

/**
 * Pick an option of a Select (the design system's, on Radix): open it, then
 * click the option by its visible name, as a person would. Native
 * `selectOption` does not work on it.
 */
export async function chooseOption(select: Locator, name: string | RegExp): Promise<void> {
  await select.click()
  await select
    .page()
    .getByRole('option', { exact: typeof name === 'string', name })
    .click()
  // Closed again: other listboxes on the page are not this select's.
  await expect(select).toHaveAttribute('aria-expanded', 'false')
}
