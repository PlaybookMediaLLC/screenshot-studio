import assert from 'node:assert/strict'
import test from 'node:test'
import { APIError } from 'better-auth/api'
import { z } from 'zod'
import { auth } from '../lib/auth/server'

test('direct Better Auth membership commands require a session', async () => {
  const headers = new Headers()
  for (const operation of [
    () => auth.api.updateMemberRole({ headers, body: { memberId: 'target', role: 'viewer' } }),
    () => auth.api.removeMember({ headers, body: { memberIdOrEmail: 'target' } }),
    () => auth.api.leaveOrganization({ headers, body: { organizationId: 'workspace' } }),
  ])
    await assert.rejects(
      operation,
      (error) => error instanceof APIError && error.statusCode === 401
    )
})

test('membership commands reject caller-supplied authority', async () => {
  const roleBody = { memberId: 'target', role: 'viewer' as const, userId: 'forged' }
  const removeBody = { memberIdOrEmail: 'target', sessionId: 'forged' }
  const leaveBody = { organizationId: 'workspace', userId: 'forged' }
  for (const operation of [
    () => auth.api.updateMemberRole({ headers: new Headers(), body: roleBody }),
    () => auth.api.removeMember({ headers: new Headers(), body: removeBody }),
    () => auth.api.leaveOrganization({ headers: new Headers(), body: leaveBody }),
  ])
    await assert.rejects(
      operation,
      (error) =>
        z
          .object({
            statusCode: z.literal(400),
            body: z.object({ code: z.literal('VALIDATION_ERROR') }),
          })
          .safeParse(error).success
    )
})

test('the Better Auth role endpoint rejects owner elevation', async () => {
  const response = await auth.handler(
    new Request('http://localhost:3460/api/auth/organization/update-member-role', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ memberId: 'target', role: 'owner' }),
    })
  )
  assert.equal(response.status, 400)
  assert.equal(
    z.object({ code: z.literal('VALIDATION_ERROR') }).safeParse(await response.json()).success,
    true
  )
})
