import { HocuspocusProvider, MessageType } from '@hocuspocus/provider'
import { expect, type Page } from '@playwright/test'
import { createDecoder, readVarString, readVarUint } from 'lib0/decoding'
import { z } from 'zod'
import * as Y from 'yjs'
import { acceptInvitation, signUpAndCreateWorkspace, signUpViaApi } from './framework/auth'
import { draftEditor, expectSaved, openNewDraft } from './framework/content-drafts'
import { configureE2EFlow, test } from './framework/flow'
import {
  apiRequest,
  createPublishingWorkspace,
  getActiveOrganizationId,
  requestJson,
} from './framework/publishing'
import { createE2EDatabase } from './framework/services'
import { trpcMutation, trpcQuery } from './framework/trpc'

configureE2EFlow()

/** The collaboration server as the browser reaches it. */
const collabUrl = process.env.E2E_COLLAB_URL ?? 'ws://localhost:1234'

/** Confirm the browser caret moved before typing into the live editor. */
async function endOfText(page: Page, text: string): Promise<void> {
  const sentence = draftEditor(page).getByText(text, { exact: true })
  await sentence.click()
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End')
  await expect
    .poll(() =>
      sentence.evaluate(() => {
        const selection = window.getSelection()
        return { text: selection?.focusNode?.textContent, offset: selection?.focusOffset }
      })
    )
    .toEqual({ text, offset: text.length })
}

/** Try to join a draft's document with a token; resolves to whether it was refused. */
async function joinIsRefused(documentName: string, token: string): Promise<boolean> {
  const document = new Y.Doc()
  return new Promise<boolean>((resolve, reject) => {
    const timeout = setTimeout(() => {
      provider.destroy()
      document.destroy()
      reject(new Error('Collaboration authorization did not complete.'))
    }, 10_000)
    const finish = (refused: boolean) => {
      clearTimeout(timeout)
      provider.destroy()
      document.destroy()
      resolve(refused)
    }
    const provider = new HocuspocusProvider({
      document,
      name: documentName,
      onAuthenticationFailed: () => {
        finish(true)
      },
      onSynced: () => {
        finish(false)
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
}, testInfo) => {
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

    await memberPage.goto(`/write/${draftId}`)
    await expect(draftEditor(memberPage)).toContainText('Written by the owner.', {
      timeout: 60_000,
    })
    // Presence names the workspace members, not demo users.
    await expect(page.getByTestId('presence')).toContainText('Bea Collaborator')
    await expect(memberPage.getByTestId('presence')).toContainText(identity.name)

    // Put the caret at the end of the owner's sentence.
    await endOfText(memberPage, 'Written by the owner.')
    await memberPage.keyboard.type(' Edited by Bea.')
    await expect(draftEditor(page)).toContainText('Written by the owner. Edited by Bea.')
    // The member's caret shows in the owner's editor, labelled with their name.
    await expect(
      page.getByTestId('remote-cursor').filter({ hasText: 'Bea Collaborator' })
    ).toBeVisible()

    // Two independent editors submit live changes at the same position.
    // CRDT ordering may differ, but both contributions must converge and save.
    await endOfText(page, 'Written by the owner. Edited by Bea.')
    await endOfText(memberPage, 'Written by the owner. Edited by Bea.')
    await Promise.all([
      page.keyboard.insertText(' Owner concurrent.'),
      memberPage.keyboard.insertText(' Bea concurrent.'),
    ])
    for (const participant of [page, memberPage]) {
      await expect(draftEditor(participant)).toContainText('Owner concurrent.')
      await expect(draftEditor(participant)).toContainText('Bea concurrent.')
    }
    const expectedContent = (
      await draftEditor(page).locator('[data-slate-string]').allTextContents()
    ).join('')
    await expect
      .poll(async () =>
        (await draftEditor(memberPage).locator('[data-slate-string]').allTextContents()).join('')
      )
      .toBe(expectedContent)
    await expect
      .poll(
        async () =>
          z
            .object({ plainText: z.string() })
            .parse((await apiRequest(page, `/api/v1/content-drafts/${draftId}`)).body).plainText
      )
      .toContain('Owner concurrent.')
    await expect
      .poll(
        async () =>
          z
            .object({ plainText: z.string() })
            .parse((await apiRequest(page, `/api/v1/content-drafts/${draftId}`)).body).plainText
      )
      .toContain('Bea concurrent.')

    // Decode the stored CRDT, not merely a non-null or earlier snapshot.
    const database = createE2EDatabase()
    try {
      const storedText = async () => {
        const result = await database.query(
          'SELECT "collabState" AS state FROM content_draft WHERE id=$1',
          [draftId]
        )
        const state = z
          .object({ state: z.instanceof(Buffer).nullable() })
          .parse(result.rows[0]).state
        if (!state) return ''
        const document = new Y.Doc()
        try {
          Y.applyUpdate(document, state)
          return document.get('content', Y.XmlText).toString()
        } finally {
          document.destroy()
        }
      }
      await expect.poll(storedText, { timeout: 30_000 }).toContain('Owner concurrent.')
      await expect.poll(storedText, { timeout: 30_000 }).toContain('Bea concurrent.')
    } finally {
      await database.end()
    }
    await page.reload()
    await expect
      .poll(
        async () =>
          (await draftEditor(page).locator('[data-slate-string]').allTextContents()).join(''),
        { timeout: 60_000 }
      )
      .toBe(expectedContent)
    await page.screenshot({ path: testInfo.outputPath('collaboration-converged.png') })

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

test('demotion blocks live edits and removal stops an already open reader', async ({
  browser,
  identity,
  page,
}, testInfo) => {
  test.slow()
  const organizationId = await signUpAndCreateWorkspace(identity, page)
  const memberIdentity = {
    ...identity,
    email: `revoked-${identity.email}`,
    name: 'Revoked collaborator',
  }
  const invited = await requestJson(page, '/api/auth/organization/invite-member', {
    email: memberIdentity.email,
    organizationId,
    role: 'creator',
  })
  expect(invited.status).toBe(200)
  const invitationId = z.object({ id: z.string() }).parse(invited.body).id
  const context = await browser.newContext()
  const database = createE2EDatabase()
  try {
    const member = await context.newPage()
    let closedDocuments = 0
    member.on('websocket', (socket) => {
      if (socket.url().startsWith(collabUrl))
        socket.on('framereceived', ({ payload }) => {
          // Hocuspocus closes one logical document on a multiplexed socket.
          const decoder = createDecoder(
            typeof payload === 'string' ? Buffer.from(payload) : payload
          )
          readVarString(decoder)
          if (readVarUint(decoder) === MessageType.CLOSE) closedDocuments++
        })
    })
    await signUpViaApi(memberIdentity, member)
    await acceptInvitation(member, invitationId)
    const members = z
      .object({
        members: z.array(z.object({ id: z.string(), user: z.object({ email: z.string() }) })),
      })
      .parse((await trpcQuery(page, 'workspace.listMembers')).body)
    const membership = members.members.find((entry) => entry.user.email === memberIdentity.email)
    if (!membership) throw new Error('Accepted membership was not listed.')
    const draftId = await openNewDraft(page)
    await draftEditor(page).click()
    await page.keyboard.type('Visible to the team.')
    await expectSaved(page)
    await member.goto(`/write/${draftId}`)
    await expect(draftEditor(member)).toContainText('Visible to the team.')
    await expect(page.getByTestId('presence')).toContainText(memberIdentity.name)

    expect(
      (
        await requestJson(page, '/api/auth/organization/update-member-role', {
          memberId: membership.id,
          organizationId,
          role: 'viewer',
        })
      ).status
    ).toBe(200)
    const deniedSave = member.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' &&
        response.url().endsWith(`/api/v1/content-drafts/${draftId}`)
    )
    await draftEditor(member).click()
    await member.keyboard.press('ControlOrMeta+End')
    await member.keyboard.type(' Forbidden live edit.')
    expect((await deniedSave).status()).toBe(403)
    await expect(draftEditor(page)).not.toContainText('Forbidden live edit.')
    await draftEditor(page).click()
    await page.keyboard.press('ControlOrMeta+End')
    await page.keyboard.type(' Allowed owner update.')
    await expectSaved(page)
    await expect(draftEditor(member)).toContainText('Allowed owner update.')

    const storedText = async () => {
      const result = await database.query(
        'SELECT "collabState" AS state FROM content_draft WHERE id=$1',
        [draftId]
      )
      const state = z.object({ state: z.instanceof(Buffer).nullable() }).parse(result.rows[0]).state
      if (!state) return ''
      const document = new Y.Doc()
      try {
        Y.applyUpdate(document, state)
        return document.get('content', Y.XmlText).toString()
      } finally {
        document.destroy()
      }
    }
    await expect.poll(storedText, { timeout: 20_000 }).toContain('Allowed owner update.')
    expect(await storedText()).not.toContain('Forbidden live edit.')
    await member.reload()
    const reader = member.getByTestId('draft-editor')
    await expect(reader).toBeVisible()
    await expect(reader).toContainText('Allowed owner update.')
    await expect(reader).not.toContainText('Forbidden live edit.')
    await member.screenshot({ path: testInfo.outputPath('collaboration-demoted-reader.png') })
    const oldToken = z
      .object({ token: z.string() })
      .parse(
        (await requestJson(member, `/api/v1/content-drafts/${draftId}/collab-token`, {})).body
      ).token

    const closedBeforeRemoval = closedDocuments
    expect(
      (await trpcMutation(page, 'workspace.removeMember', { memberId: membership.id })).status
    ).toBe(200)
    await draftEditor(page).click()
    await page.keyboard.press('ControlOrMeta+End')
    await page.keyboard.type(' Private after removal.')
    await expectSaved(page)
    await expect.poll(() => closedDocuments).toBeGreaterThan(closedBeforeRemoval)
    await expect(reader).not.toContainText('Private after removal.')
    await expect(page.getByTestId('presence')).not.toContainText(memberIdentity.name)
    expect(await joinIsRefused(`content-draft:${draftId}`, oldToken)).toBe(true)
    expect((await apiRequest(member, `/api/v1/content-drafts/${draftId}`)).status).toBe(401)
    await expect.poll(storedText, { timeout: 20_000 }).toContain('Private after removal.')
    expect(await storedText()).not.toContain('Forbidden live edit.')
    await page.screenshot({ path: testInfo.outputPath('collaboration-after-removal.png') })
    await member.reload()
    await expect.poll(() => new URL(member.url()).pathname).toBe('/sign-in')
  } finally {
    await context.close()
    await database.end()
  }
})
