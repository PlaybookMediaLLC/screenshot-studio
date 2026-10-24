import { expect, type Locator, type Page } from '@playwright/test'
import { createE2EDatabase } from './services'
import type { E2EIdentity } from './flow'
import { type HttpMockServer, startHttpMockServer } from './http-server'
import {
  apiRequest,
  bindTestGoOrganization,
  connectionSchema,
  createPublishingWorkspace,
  e2eSecretReference,
  enablePublishingTwoFactor,
  trpcMutation,
} from './publishing'

/**
 * Setup for the content draft flows (RFC 013): a paid workspace bound to the
 * social API mock, with one connected channel per platform. The mock answers the
 * destination checks only; posts are scheduled for later, so nothing
 * publishes during a test.
 */

/** The suite's social API mock port; the stack's SOCIAL_API_URL points at it. */
export const socialMockPort = Number(process.env.E2E_SOCIAL_MOCK_PORT ?? 5679)

/** Credential-free standard X identity supplied only by the local protocol fixture. */
const xVerification = {
  accountKey: 'x:123456789',
  accountKind: 'profile',
  grantedScopes: ['read-write'],
  capabilities: {
    version: 1,
    x: {
      oauth1AccessLevel: 'read-write',
      subscriptionType: null,
      standardMaxWeightedCharacters: 280,
      charactersReservedPerUrl: 23,
      maxImages: 4,
      maxGifs: 1,
      maxVideos: 1,
      imageMaxBytes: 5000000,
      gifMaxBytes: 15000000,
      longPostMaxWeightedCharacters: null,
      articles: null,
      videoMaxBytes: null,
      videoMaxDurationSeconds: null,
    },
  },
}

export type DraftWorkspace = {
  channels: Record<string, string>
  organizationId: string
  provider: HttpMockServer
}

export async function createDraftWorkspace(
  identity: E2EIdentity,
  page: Page,
  platforms: readonly string[] = ['x', 'linkedin'],
  options: { verifiedStandardVideo?: boolean } = {}
): Promise<DraftWorkspace> {
  let organizationId = ''
  const verification = options.verifiedStandardVideo
    ? {
        ...xVerification,
        capabilities: {
          ...xVerification.capabilities,
          x: {
            ...xVerification.capabilities.x,
            subscriptionType: 'None',
            articles: false,
            videoMaxBytes: 8_000_000_000,
            videoMaxDurationSeconds: 1200,
          },
        },
      }
    : xVerification
  const provider = await startHttpMockServer((request) => {
    if (request.url === '/api/public/v1/me') {
      return { body: { organization: { id: `go-${organizationId}` } } }
    }
    if (request.url === `/api/public/v1/integrations/social-${organizationId}-x/identity`) {
      return {
        body: {
          id: `social-${organizationId}-x`,
          provider: 'x',
          nativeId: '123456789',
          name: 'Shots on X',
          handle: 'shots_x',
          active: true,
          verifiedAt: new Date().toISOString(),
          verification,
        },
      }
    }
    if (request.url === '/api/public/v1/integrations') {
      return {
        body: platforms.map((platform) => ({
          disabled: false,
          id: `social-${organizationId}-${platform}`,
          identifier: platform,
          name: `Shots on ${platform}`,
          picture: '',
          profile: `shots_${platform}`,
        })),
      }
    }
    return { body: { error: 'Unexpected request.' }, status: 500 }
  }, socialMockPort)
  await createPublishingWorkspace(identity, page)
  // Connecting a channel and cancelling a post are sensitive actions.
  await enablePublishingTwoFactor(page, identity.password)
  organizationId = await bindTestGoOrganization(page)
  // The product checks actual provider credentials in the shared database.
  // The HTTP fixture still owns destination verification; neither path bypasses health.
  const database = createE2EDatabase()
  try {
    await database.query(
      `INSERT INTO "Organization" (id,name,"updatedAt") VALUES ($1,'Draft fixture',now())`,
      [`go-${organizationId}`]
    )
    for (const platform of platforms) {
      await database.query(
        `INSERT INTO "Integration" (id,"internalId","organizationId",name,"providerIdentifier",type,token)
         VALUES ($1,$1,$2,$3,$3,'social','fixture-only-credential')`,
        [`social-${organizationId}-${platform}`, `go-${organizationId}`, platform]
      )
      if (platform === 'x') {
        await database.query(
          `UPDATE "Integration" SET "internalId"='123456789', "verifiedAccountKey"=$2,
          "verifiedAccountKind"=$3, "verifiedScopes"=$4, "verifiedCapabilities"=$5, "identityVerifiedAt"=now()
          WHERE id=$1`,
          [
            `social-${organizationId}-x`,
            verification.accountKey,
            verification.accountKind,
            JSON.stringify(verification.grantedScopes),
            JSON.stringify(verification.capabilities),
          ]
        )
      }
    }
  } finally {
    await database.end()
  }
  const channels: Record<string, string> = {}
  for (const platform of platforms) {
    const response = await trpcMutation(page, 'channelConnection.create', {
      externalAccountId: `social-${organizationId}-${platform}`,
      platform,
      secretReference: e2eSecretReference,
    })
    expect(response.status, JSON.stringify(response.body)).toBe(200)
    channels[platform] = connectionSchema.parse(response.body).connection.id
  }
  return { channels, organizationId, provider }
}

/**
 * Turn on draft tags for the signed-in person: a settings platform
 * experiment (RFC 024) the backend enforces. Planning was promoted.
 */
export async function enableDraftTags(page: Page): Promise<void> {
  const response = await apiRequest(page, '/api/v1/me/preferences', {
    body: { experiments: { 'draft-tags': true } },
    method: 'PATCH',
  })
  expect(response.status, JSON.stringify(response.body)).toBe(200)
}

/** The draft body editor. */
export function draftEditor(page: Page) {
  return page.getByRole('textbox', { name: 'Draft body' })
}

/** Wait until autosave has written every change. */
export async function expectSaved(page: Page): Promise<void> {
  await expect(page.getByTestId('save-state')).toHaveText('Saved', { timeout: 20_000 })
}

/** How the composer names each platform. */
const PLATFORM_LABELS: Record<string, string> = { linkedin: 'LinkedIn', x: 'X' }

/** Open a new draft from the Write library; returns its id. */
export async function openNewDraft(page: Page): Promise<string> {
  await page.goto('/write')
  await page.getByTestId('new-draft').first().click()
  await page.waitForURL(/\/write\/[a-z0-9]+/)
  await expect(draftEditor(page)).toBeVisible({ timeout: 60_000 })
  return new URL(page.url()).pathname.split('/').pop() ?? ''
}

/**
 * Turn platforms on in the composer's Manage platforms dialog, then close it.
 * A new draft already publishes to every platform of its set, so this
 * confirms them rather than adding any.
 */
export async function chooseChannels(page: Page, platforms: readonly string[]): Promise<void> {
  await page.getByRole('button', { name: 'Manage platforms' }).click()
  const dialog = page.getByRole('dialog')
  for (const platform of platforms) {
    await dialog.getByRole('switch', { name: `Publish to ${PLATFORM_LABELS[platform]}` }).check()
  }
  await dialog.getByRole('button', { name: 'Done' }).click()
  await expect(dialog).toHaveCount(0)
}

/** Run checks against the previews, with the preview panel open, then close it. */
export async function inPreview(page: Page, check: () => Promise<void>): Promise<void> {
  const toggle = page.getByRole('button', { name: 'Preview', exact: true })
  await toggle.click()
  await expect(page.getByTestId('preview-panel')).toBeVisible()
  await check()
  await toggle.click()
  await expect(page.getByTestId('preview-panel')).toHaveCount(0)
}

/**
 * Show one platform in the open preview panel. Returns its post preview; the
 * panel around it lists what blocks it and what changes when it is posted.
 */
export async function previewOf(page: Page, platform: string): Promise<Locator> {
  await page
    .getByTestId('preview-panel')
    .getByRole('button', { name: PLATFORM_LABELS[platform], exact: true })
    .click()
  return page.getByTestId(`preview-${platform}`)
}

/** Open the schedule dialog from the top bar; returns it. */
export async function openSchedule(page: Page): Promise<Locator> {
  await page.getByTestId('schedule-button').click()
  const dialog = page.getByTestId('schedule-dialog')
  await expect(dialog).toBeVisible()
  return dialog
}
