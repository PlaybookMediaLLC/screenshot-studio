import assert from 'node:assert/strict'
import test from 'node:test'
import { APIError } from 'better-auth/api'
import { z } from 'zod'
import { auth } from '../lib/auth/server'

test('direct Better Auth invitation endpoints require a real session', async () => {
  const headers = new Headers()
  const body = { invitationId: 'unavailable' }
  for (const operation of [
    () => auth.api.acceptInvitation({ body, headers }),
    () => auth.api.rejectInvitation({ body, headers }),
    () => auth.api.cancelInvitation({ body, headers }),
    () => auth.api.getInvitation({ query: { id: body.invitationId }, headers }),
    () =>
      auth.api.createInvitation({
        body: { email: 'recipient@example.test', role: 'viewer' },
        headers,
      }),
  ])
    await assert.rejects(
      operation,
      (error) => error instanceof APIError && error.statusCode === 401
    )
})

test('invitation responses reject caller-supplied identity and destination fields', async () => {
  for (const body of [
    { invitationId: 'unavailable', userId: 'impersonated' },
    { invitationId: 'unavailable', organizationId: 'wrong-target' },
    { invitationId: 'unavailable', role: 'owner' },
  ])
    await assert.rejects(
      () => auth.api.acceptInvitation({ body, headers: new Headers() }),
      (error) =>
        z
          .object({
            statusCode: z.literal(400),
            body: z.object({ code: z.literal('VALIDATION_ERROR') }),
          })
          .safeParse(error).success
    )
})
