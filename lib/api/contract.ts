import { z } from 'zod'
import { contractAccessSchema } from '@/lib/api/access-requirements'

/**
 * Route contracts: the pure-zod description of a platform API operation.
 *
 * A contract names the operation and holds the schemas for its path params,
 * query, body, and response. It imports nothing server-only, so the same
 * contract drives `route()`, the generated OpenAPI spec, and plain-Node tests.
 */

/** HTTP methods a platform route handles. */
export const httpMethodSchema = z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])

/** One of {@link httpMethodSchema}. */
export type HttpMethod = z.infer<typeof httpMethodSchema>

/** Success statuses a platform route returns. */
export const httpSuccessStatusSchema = z.literal([200, 201, 202, 204])

/** One of {@link httpSuccessStatusSchema}. */
export type HttpSuccessStatus = z.infer<typeof httpSuccessStatusSchema>

/**
 * How the body is read: parsed JSON, or the raw text for routes that verify a
 * signature over the exact bytes.
 */
export const bodyFormatSchema = z.enum(['json', 'text'])

/** One of {@link bodyFormatSchema}. */
export type BodyFormat = z.infer<typeof bodyFormatSchema>

/** OpenAPI tags for documented operations. */
export const openApiTagSchema = z.enum([
  'Approvals',
  'Assets',
  'Campaigns',
  'Publishing',
  'Shell',
  'Workspace',
])

/** OpenAPI security schemes for documented operations. */
export const openApiSecuritySchema = z.enum(['workspaceApiKey', 'workspaceSession'])

/** Response statuses an OpenAPI operation can document. */
export const documentedStatusSchema = z.enum([
  '200',
  '201',
  '202',
  '204',
  '400',
  '401',
  '403',
  '404',
  '409',
  '422',
  '429',
  '503',
])

/** One of {@link documentedStatusSchema}. */
export type DocumentedStatus = z.infer<typeof documentedStatusSchema>

const componentNameSchema = z.string().regex(/^[A-Z][A-Za-z]+$/)

/** OpenAPI documentation for a public contract. Internal contracts omit it. */
export const contractDocsSchema = z.object({
  /** Component name for the body schema; an unnamed body is inlined. */
  bodyName: componentNameSchema.optional(),
  description: z.string().min(21),
  /** Vendor extensions, such as `x-shots-entitlement`. */
  extensions: z.record(z.string().regex(/^x-/), z.unknown()).optional(),
  operationId: z.string().regex(/^[a-zA-Z][a-zA-Z0-9]*$/),
  /** Component name for the response schema; an unnamed response is inlined. */
  outputName: componentNameSchema.optional(),
  /** A description for every documented status. */
  responses: z.partialRecord(documentedStatusSchema, z.string().min(1)),
  /** The scheme of a contract without `access`; one with `access` derives it. */
  security: openApiSecuritySchema.optional(),
  tag: openApiTagSchema,
})

/** One of {@link contractDocsSchema}. */
export type ContractDocs = z.infer<typeof contractDocsSchema>

/** The schema of an absent query or body. */
export const noInputSchema = z.undefined()

/** The schema of a route without path params. */
export const noParamsSchema = z.object({})

/**
 * A timestamp on the wire. Handlers return a `Date`; responses carry its
 * ISO-8601 string.
 */
export const timestampSchema = z.codec(z.date(), z.string(), {
  decode: (date) => date.toISOString(),
  encode: (text) => new Date(text),
})

/**
 * The page envelope of a collection (RFC 014). `nextCursor` is opaque: pass
 * it back as `cursor` for the next page.
 */
export const paginationSchema = z.object({
  hasMore: z.boolean(),
  nextCursor: z.string().nullable(),
})

/** One of {@link paginationSchema}. */
export type Pagination = z.infer<typeof paginationSchema>

/** A collection response: `{ data, pagination }` with `item` as each entry. */
export function pageOf<Item extends z.ZodType>(item: Item) {
  return z.object({ data: z.array(item), pagination: paginationSchema })
}

/**
 * Compile-time guard that `schema` accepts exactly the values of type
 * `Source`: each must be assignable to the other. A field the schema would
 * strip, or a value it would reject, fails the build. Returns `schema`.
 */
export function mirrors<Source>() {
  return <S extends z.ZodType>(
    schema: S &
      ([Source] extends [z.input<S>] ? ([z.input<S>] extends [Source] ? unknown : never) : never)
  ): S => schema
}

/** Everything about a contract except its schemas. */
export const routeContractMetaSchema = z.object({
  /** Who may call it: the route binds this, and OpenAPI publishes it. */
  access: contractAccessSchema.optional(),
  bodyFormat: bodyFormatSchema.default('json'),
  docs: contractDocsSchema.optional(),
  method: httpMethodSchema,
  /** Stable name for logs and metrics, such as `releases.create`. */
  name: z.string().regex(/^[a-z0-9-]+(\.[a-z0-9-]+)*$/),
  /** The route's URL pattern, such as `/api/v1/assets/{assetId}`. */
  path: z.string().regex(/^\/api\//),
  /** A human-shell endpoint: refuses API keys and logs as `playbook.shell_request`. */
  shell: z.boolean().default(false),
  /** The default success status. */
  status: httpSuccessStatusSchema.default(200),
  summary: z.string().min(1),
})

/** A complete contract: the metadata plus its schemas. */
export const routeContractSchema = routeContractMetaSchema.extend({
  body: z.instanceof(z.ZodType),
  headers: z.instanceof(z.ZodType),
  output: z.instanceof(z.ZodType),
  params: z.instanceof(z.ZodType),
  query: z.instanceof(z.ZodType),
})

/** One of {@link routeContractSchema}. */
export type RouteContract = z.infer<typeof routeContractSchema>

/**
 * Declare a contract. Omitted `params` default to {@link noParamsSchema};
 * omitted `query`, `headers`, and `body` default to {@link noInputSchema}.
 * The metadata is validated when the module loads. `access` keeps its
 * declared shape, so a route can only bind the authenticator it names.
 */
export function defineContract<
  Output extends z.ZodType,
  Params extends z.ZodType = typeof noParamsSchema,
  Query extends z.ZodType = typeof noInputSchema,
  Headers extends z.ZodType = typeof noInputSchema,
  Body extends z.ZodType = typeof noInputSchema,
  Access extends z.input<typeof contractAccessSchema> | undefined = undefined,
>(
  contract: Omit<z.input<typeof routeContractMetaSchema>, 'access'> & {
    access?: Access
    body?: Body
    /** Request headers the handler reads, keyed by lowercase name. */
    headers?: Headers
    output: Output
    params?: Params
    query?: Query
  }
) {
  const meta = routeContractMetaSchema.parse(contract)
  return {
    ...meta,
    access: meta.access as Access,
    body: (contract.body ?? noInputSchema) as Body,
    headers: (contract.headers ?? noInputSchema) as Headers,
    output: contract.output,
    params: (contract.params ?? noParamsSchema) as Params,
    query: (contract.query ?? noInputSchema) as Query,
  }
}
