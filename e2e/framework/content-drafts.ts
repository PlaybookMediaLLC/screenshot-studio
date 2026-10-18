import { expect, type Page } from '@playwright/test'
import type { E2EIdentity } from './flow'
import { type HttpMockServer, startHttpMockServer } from './http-server'
import {
  bindTestGoOrganization,
  connectionSchema,
  createPublishingWorkspace,
  e2eSecretReference,
  enablePublishingTwoFactor,
  trpcMutation,
} from './publishing'

/**
 * Setup for the content draft flows (RFC 037): a paid workspace bound to the
 * Postiz mock, with one connected channel per platform. The mock answers the
 * destination checks only; posts are scheduled for later, so nothing
 * publishes during a test.
 */

/** The suite's Postiz mock port; the stack's POSTIZ_API_URL points at it. */
export const postizMockPort = Number(process.env.E2E_POSTIZ_MOCK_PORT ?? 5679)

export type DraftWorkspace = {
  channels: Record<string, string>
  organizationId: string
  provider: HttpMockServer
}

export async function createDraftWorkspace(
  identity: E2EIdentity,
  page: Page,
  platforms: readonly string[] = ['x', 'linkedin']
): Promise<DraftWorkspace> {
  let organizationId = ''
  const provider = await startHttpMockServer((request) => {
    if (request.url === '/api/public/v1/me') {
      return { body: { organization: { id: `go-${organizationId}` } } }
    }
    if (request.url === '/api/public/v1/integrations') {
      return {
        body: platforms.map((platform) => ({
          disabled: false,
          id: `postiz-${platform}`,
          identifier: platform,
        })),
      }
    }
    return { body: { error: 'Unexpected request.' }, status: 500 }
  }, postizMockPort)
  await createPublishingWorkspace(identity, page)
  // Connecting a channel and cancelling a post are sensitive actions.
  await enablePublishingTwoFactor(page, identity.password)
  organizationId = await bindTestGoOrganization(page)
  const channels: Record<string, string> = {}
  for (const platform of platforms) {
    const response = await trpcMutation(page, 'channelConnection.create', {
      externalAccountId: `postiz-${platform}`,
      platform,
      secretReference: e2eSecretReference,
    })
    expect(response.status, JSON.stringify(response.body)).toBe(200)
    channels[platform] = connectionSchema.parse(response.body).connection.id
  }
  return { channels, organizationId, provider }
}

/** The draft body editor. */
export function draftEditor(page: Page) {
  return page.getByRole('textbox', { name: 'Draft body' })
}

/** Wait until autosave has written every change. */
export async function expectSaved(page: Page): Promise<void> {
  await expect(page.getByTestId('save-state')).toHaveText('Saved', { timeout: 20_000 })
}

/** Open a new draft from the drafts list; returns its id. */
export async function openNewDraft(page: Page): Promise<string> {
  await page.goto('/drafts')
  await page.getByRole('button', { name: 'New draft' }).click()
  await page.waitForURL(/\/drafts\/[a-z0-9]+$/)
  await expect(draftEditor(page)).toBeVisible({ timeout: 60_000 })
  return new URL(page.url()).pathname.split('/').pop() ?? ''
}
