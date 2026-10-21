import assert from 'node:assert/strict'
import test from 'node:test'
import { createTRPCClient, httpLink, TRPCClientError } from '@trpc/client'
import { fetchRequestHandler } from '@trpc/server/adapters/fetch'
import { TRPCError } from '@trpc/server'
import superjson from 'superjson'
import { z } from 'zod'
import { automationSaveSchema } from '../lib/api/contracts/release-automation'
import { publicProcedure, router } from '../lib/trpc/init'

test('workflow save exposes validation paths over HTTP and never runs an invalid mutation', async () => {
  let saves = 0
  const app = router({
    releaseAutomation: router({
      save: publicProcedure.input(automationSaveSchema).mutation(() => {
        saves++
        return true
      }),
    }),
  })
  const client = createTRPCClient<typeof app>({
    links: [
      httpLink({
        url: 'http://localhost/api/trpc',
        transformer: superjson,
        fetch: (url, init) =>
          fetchRequestHandler({
            endpoint: '/api/trpc',
            req: new Request(url, init),
            router: app,
            createContext: () => ({ headers: new Headers() }),
          }),
      }),
    ],
  })
  await assert.rejects(
    client.releaseAutomation.save.mutate({
      id: 'workflow',
      sourceAppId: 'source',
      name: 'Workflow',
      description: '',
      priority: 99999,
      expectedRevision: 2,
      graph: {
        schemaVersion: 1,
        family: 'release.published',
        qualification: {},
        nodes: [],
        edges: [],
      },
      layout: {},
    }),
    (error: unknown) => {
      assert.ok(error instanceof TRPCClientError)
      assert.equal(error.data.httpStatus, 400)
      assert.deepEqual(error.data.fieldErrors, [{ field: 'priority', message: 'Must be 0–9999.' }])
      return true
    }
  )
  assert.equal(saves, 0)
})

test('workflow validation details are not exposed for output errors or other procedures', async () => {
  const { workflowFieldErrors } = await import('../lib/trpc/workflow-field-errors')
  const parsed = automationSaveSchema.safeParse({ priority: 99999 })
  assert.ok(!parsed.success)
  assert.deepEqual(
    workflowFieldErrors(
      new TRPCError({ code: 'INTERNAL_SERVER_ERROR', cause: parsed.error }),
      'releaseAutomation.save'
    ),
    []
  )
  assert.deepEqual(
    workflowFieldErrors(
      new TRPCError({ code: 'BAD_REQUEST', cause: parsed.error }),
      'another.save'
    ),
    []
  )
})

test('response validation failures remain server errors without exposing field details', async () => {
  const app = router({
    releaseAutomation: router({
      save: publicProcedure.output(z.string().min(10)).mutation(() => 'short'),
    }),
  })
  const client = createTRPCClient<typeof app>({
    links: [
      httpLink({
        url: 'http://localhost/api/trpc',
        transformer: superjson,
        fetch: (url, init) =>
          fetchRequestHandler({
            endpoint: '/api/trpc',
            req: new Request(url, init),
            router: app,
            createContext: () => ({ headers: new Headers() }),
          }),
      }),
    ],
  })
  await assert.rejects(client.releaseAutomation.save.mutate(), (error: unknown) => {
    assert.ok(error instanceof TRPCClientError)
    assert.equal(error.data.httpStatus, 500)
    assert.deepEqual(error.data.fieldErrors, [])
    return true
  })
})
