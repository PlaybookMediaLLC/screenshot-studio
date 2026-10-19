import 'server-only'

import { createAdapterFactory, type CustomAdapter } from 'better-auth/adapters'
import { getSession } from 'better-auth/api'
import { getCurrentAuthContext } from '@better-auth/core/context'
import type { AuthStoreRequest, AuthStoreWhere } from 'screenshot-studio-backend-sdk'
import { serviceBackend } from '@/lib/backend/sdk'

type Where = {
  connector?: 'AND' | 'OR'
  field: string
  mode?: string
  operator?: string
  value: unknown
}

function where(clauses: readonly Where[] | undefined): AuthStoreWhere[] | undefined {
  return clauses?.map((clause) => ({
    connector: clause.connector,
    field: clause.field,
    mode: clause.mode === 'insensitive' ? 'insensitive' : 'sensitive',
    operator: clause.operator,
    value: clause.value instanceof Date ? clause.value.toISOString() : clause.value,
  }))
}

/** Dates cross the wire as ISO strings; the factory already does this for most fields. */
function plain(data: Record<string, unknown> | undefined) {
  return (
    data &&
    Object.fromEntries(
      Object.entries(data).map(([key, value]) => [
        key,
        value instanceof Date ? value.toISOString() : value,
      ])
    )
  )
}

async function store(request: AuthStoreRequest) {
  if (request.model === 'member' && !['findOne', 'findMany', 'count'].includes(request.op)) {
    const context = await getCurrentAuthContext().catch(() => null)
    const session =
      context?.context.session ??
      (context?.headers
        ? await getSession()({
            context: context.context,
            headers: context.headers,
            query: { disableCookieCache: true, disableRefresh: true },
          })
        : null)
    const actorSessionId = session?.session.id
    if (actorSessionId) request = { ...request, actorSessionId }
  }
  return serviceBackend().authStore(request)
}

const storeAdapter: CustomAdapter = {
  async count({ model, where: clauses }) {
    return (await store({ model, op: 'count', where: where(clauses) })).count ?? 0
  },
  async create({ data, model, select }) {
    const result = await store({ data: plain(data), model, op: 'create', select })
    return result.row as typeof data
  },
  async consumeOne({ model, where: clauses }) {
    return (await store({ model, op: 'consumeOne', where: where(clauses) })).row as never
  },
  async delete({ model, where: clauses }) {
    await store({ model, op: 'delete', where: where(clauses) })
  },
  async deleteMany({ model, where: clauses }) {
    return (await store({ model, op: 'deleteMany', where: where(clauses) })).count ?? 0
  },
  async findMany({ limit, model, offset, select, sortBy, where: clauses }) {
    const result = await store({
      limit,
      model,
      offset,
      op: 'findMany',
      select,
      sortBy,
      where: where(clauses),
    })
    return (result.rows ?? []) as never[]
  },
  async findOne({ model, select, where: clauses }) {
    return (await store({ model, op: 'findOne', select, where: where(clauses) })).row as never
  },
  async incrementOne({ increment, model, set, where: clauses }) {
    return (
      await store({
        data: plain(set),
        increment,
        model,
        op: 'incrementOne',
        where: where(clauses),
      })
    ).row as never
  },
  async update({ model, update, where: clauses }) {
    return (
      await store({
        data: plain(update as Record<string, unknown>),
        model,
        op: 'update',
        where: where(clauses),
      })
    ).row as never
  },
  async updateMany({ model, update, where: clauses }) {
    return (
      (await store({ data: plain(update), model, op: 'updateMany', where: where(clauses) }))
        .count ?? 0
    )
  },
}

/**
 * Better Auth keeps its password, session, 2FA, SSO, and SCIM logic here, but
 * its rows live in the backend database. Every read and write goes through the
 * backend's service-authenticated auth store, so the web holds no database
 * credentials. Each call is one backend statement; there is no cross-call
 * transaction, so Better Auth runs multi-step writes sequentially.
 */
export const backendAuthAdapter = createAdapterFactory({
  config: {
    adapterId: 'screenshot-studio-backend',
    adapterName: 'Shots backend',
    supportsBooleans: true,
    supportsDates: false,
    supportsJSON: false,
    supportsNumericIds: false,
    transaction: false,
    usePlural: false,
  },
  adapter: () => storeAdapter,
})
