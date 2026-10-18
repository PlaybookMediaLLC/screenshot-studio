import { HocuspocusProvider } from '@hocuspocus/provider'
import { expect } from '@playwright/test'
import { z } from 'zod'
import * as Y from 'yjs'
import { acceptInvitation, signUpViaApi } from './framework/auth'
import { draftEditor, openNewDraft } from './framework/content-drafts'
import { configureE2EFlow, test } from './framework/flow'
import {
  apiRequest,
  createPublishingWorkspace,
  getActiveOrganizationId,
  requestJson,
} from './framework/publishing'
import { createE2EDatabase, queryRow } from './framework/services'

configureE2EFlow()

/** The collaboration server as the browser reaches it. */
const collabUrl = process.env.E2E_COLLAB_URL ?? 'ws://localhost:1234'

/** Try to join a draft's document with a token; resolves to whether it was refused. */
async function joinIsRefused(documentName: string, token: string): Promise<boolean> {
  const document = new Y.Doc()
  return new Promise<boolean>((resolve) => {
    const provider = new HocuspocusProvider({
      document,
      name: documentName,
      onAuthenticationFailed: () => {
        provider.destroy()
        resolve(true)
      },
      onSynced: () => {
        provider.destroy()
        resolve(false)
      },
      token,
      url: collabUrl,
    })
  })
}

// RFC 037: two members edit one draft live through the Hocuspocus server,
// which authorizes and persists only through the Go backend. A member of
// another workspace gets no token for the draft, and their own token does not
// open it.
test('two members co-edit a draft live, and another workspace is refused', async ({
  browser,
  identity,
  page,
}) => {
  await createPublishingWorkspace(identity, page)
  const organizationId = await getActiveOrganizationId(page)
  const memberIdentity = {
    ...identity,
    email: `member-${identity.email}`,
    name: 'Bea Collaborator',
  }
  const invitation = await requestJson(page, '/api/auth/organization/invite-member', {
    email: memberIdentity.email,
    organizationId,
    role: 'creator',
  })
  expect(invitation.status, JSON.stringify(invitation.body)).toBe(200)
  const invitationId = z.object({ id: z.string() }).parse(invitation.body).id

  const memberContext = await browser.newContext()
  const strangerContext = await browser.newContext()
  try {
    const memberPage = await memberContext.newPage()
    await signUpViaApi(memberIdentity, memberPage)
    await acceptInvitation(memberPage, invitationId)

    const draftId = await openNewDraft(page)
    await draftEditor(page).click()
    await page.keyboard.type('Written by the owner.')

    await memberPage.goto(`/drafts/${draftId}`)
    await expect(draftEditor(memberPage)).toContainText('Written by the owner.', {
      timeout: 60_000,
    })
    // Presence names the workspace members, not demo users.
    await expect(page.getByTestId('presence')).toContainText('Bea Collaborator')
    await expect(memberPage.getByTestId('presence')).toContainText(identity.name)

    // Put the caret at the end of the owner's sentence.
    const sentence = draftEditor(memberPage).getByText('Written by the owner.')
    const box = await sentence.boundingBox()
    await sentence.click({ position: { x: (box?.width ?? 1) - 1, y: (box?.height ?? 2) / 2 } })
    await memberPage.keyboard.type(' Edited by Bea.')
    await expect(draftEditor(page)).toContainText('Written by the owner. Edited by Bea.')
    // The member's caret shows in the owner's editor, labelled with their name.
    await expect(
      page.getByTestId('remote-cursor').filter({ hasText: 'Bea Collaborator' })
    ).toBeVisible()

    // The shared state is stored through the backend and survives a reload.
    const database = createE2EDatabase()
    try {
      await expect
        .poll(
          async () =>
            (
              await queryRow<{ stored: boolean }>(
                database,
                'SELECT "collabState" IS NOT NULL AS stored FROM content_draft WHERE id = $1',
                [draftId]
              )
            )?.stored,
          { timeout: 30_000 }
        )
        .toBe(true)
    } finally {
      await database.end()
    }
    await page.reload()
    await expect(draftEditor(page)).toContainText('Written by the owner. Edited by Bea.', {
      timeout: 60_000,
    })

    const strangerPage = await strangerContext.newPage()
    await createPublishingWorkspace(
      {
        ...identity,
        email: `stranger-${identity.email}`,
        workspaceName: `Stranger ${identity.workspaceName}`,
      },
      strangerPage
    )
    const foreignToken = await apiRequest(
      strangerPage,
      `/api/v1/content-drafts/${draftId}/collab-token`,
      { body: {}, method: 'POST' }
    )
    expect(foreignToken.status).toBe(404)
    const theirDraft = z
      .object({ id: z.string() })
      .parse(
        (await apiRequest(strangerPage, '/api/v1/content-drafts', { body: {}, method: 'POST' }))
          .body
      )
    const theirToken = z.object({ token: z.string() }).parse(
      (
        await apiRequest(strangerPage, `/api/v1/content-drafts/${theirDraft.id}/collab-token`, {
          body: {},
          method: 'POST',
        })
      ).body
    ).token
    expect(await joinIsRefused(`content-draft:${draftId}`, theirToken)).toBe(true)
    // The same token does open the stranger's own draft.
    expect(await joinIsRefused(`content-draft:${theirDraft.id}`, theirToken)).toBe(false)
  } finally {
    await memberContext.close()
    await strangerContext.close()
  }
})
