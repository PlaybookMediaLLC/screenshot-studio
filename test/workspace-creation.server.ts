import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import { APIError } from 'better-auth/api'
import { z } from 'zod'
import { auth } from '../lib/auth/server'

test('direct Better Auth server creation requires a session and rejects user impersonation', async () => {
  const body = {
    name: 'Direct server attempt',
    slug: `server-attempt-${randomUUID()}`,
    idempotencyKey: randomUUID(),
  }
  await assert.rejects(
    auth.api.createOrganization({ body, headers: new Headers() }),
    (error) => error instanceof APIError && error.statusCode === 401
  )
  const impersonation = { ...body, userId: randomUUID() }
  await assert.rejects(
    auth.api.createOrganization({ body: impersonation, headers: new Headers() }),
    (error) =>
      z
        .object({
          statusCode: z.literal(400),
          body: z.object({ code: z.literal('VALIDATION_ERROR') }),
        })
        .safeParse(error).success
  )
})
