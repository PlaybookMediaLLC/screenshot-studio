import { z } from 'zod'
import { environmentSchema } from '../src/schemas.js'

const envSchema = z.looseObject({ key: z.string(), value: z.string().optional() })
const serviceSchema = z.looseObject({
  name: z.string(),
  envs: z.array(envSchema).optional(),
})
const specSchema = z.looseObject({ services: z.array(serviceSchema) })
const appSchema = z.looseObject({
  id: z.uuid(),
  spec: specSchema,
  in_progress_deployment: z.unknown().optional(),
  pending_deployment: z.unknown().optional(),
})
export const deploymentEnvironmentSchema = z
  .object({
    APP_ID: z.uuid(),
    IMAGE_DIGEST: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    RENDER_ALLOWED_ORIGIN: z.string(),
    PLATFORM_RENDER_SERVICE_SECRET: z.string(),
  })
  .superRefine((env, context) => {
    const config = environmentSchema.safeParse({
      RENDER_ALLOWED_ORIGIN: env.RENDER_ALLOWED_ORIGIN,
      RENDER_SERVICE_SECRET: env.PLATFORM_RENDER_SERVICE_SECRET,
    })
    if (!config.success) {
      for (const issue of config.error.issues)
        context.addIssue({
          code: 'custom',
          path: [
            issue.path[0] === 'RENDER_SERVICE_SECRET'
              ? 'PLATFORM_RENDER_SERVICE_SECRET'
              : 'RENDER_ALLOWED_ORIGIN',
          ],
          message: 'Invalid renderer configuration.',
        })
    }
  })
export type DeploymentEnvironment = z.infer<typeof deploymentEnvironmentSchema>

const runtimeEnv = (key: string, value: string, secret = false) => ({
  key,
  value,
  scope: 'RUN_TIME',
  type: secret ? 'SECRET' : 'GENERAL',
})
function mergeEnv(service: z.infer<typeof serviceSchema>, values: ReturnType<typeof runtimeEnv>[]) {
  const envs = new Map(service.envs?.map((env) => [env.key, env]))
  for (const env of values) envs.set(env.key, env)
  return [...envs.values()]
}

export function renderSpec(input: unknown, rawEnvironment: unknown) {
  const env = deploymentEnvironmentSchema.parse(rawEnvironment)
  const app = appSchema.parse(Array.isArray(input) ? input[0] : input)
  if (app.id !== env.APP_ID) throw new Error('App ID does not match the requested deployment.')
  const busy = (value: unknown) => {
    if (value == null) return false
    const deployment = z.object({ phase: z.string().optional() }).parse(value)
    return (
      Object.keys(value as object).length > 0 &&
      !['ACTIVE', 'ERROR', 'CANCELED', 'SUPERSEDED'].includes(deployment.phase ?? '')
    )
  }
  if (busy(app.in_progress_deployment) || busy(app.pending_deployment)) {
    throw new Error('Another App Platform deployment is pending; retry after it finishes.')
  }
  const spec = structuredClone(app.spec)
  const web = spec.services.find((service) => service.name === 'web')
  if (!web) throw new Error('The target app has no web service.')
  const existing = spec.services.find((service) => service.name === 'design-renderer')
  const tuningKeys = [
    'RENDER_CONCURRENCY',
    'RENDER_MAX_QUEUE',
    'RENDER_QUEUE_TIMEOUT_MS',
    'RENDER_TIMEOUT_MS',
    'RENDER_RECYCLE_AFTER',
  ]
  const tuning = Object.fromEntries(
    (existing?.envs ?? [])
      .filter((item) => tuningKeys.includes(item.key))
      .map((item) => [item.key, item.value])
  )
  const runtime = environmentSchema.parse({
    ...tuning,
    RENDER_ALLOWED_ORIGIN: env.RENDER_ALLOWED_ORIGIN,
    RENDER_SERVICE_SECRET: env.PLATFORM_RENDER_SERVICE_SECRET,
  })
  // The web caller currently gives up after 75 seconds. Leave cleanup/network margin.
  if (runtime.queueTimeoutMs + runtime.timeoutMs > 70000) {
    throw new Error('Renderer queue and render deadlines must total at most 70000 ms.')
  }
  // This component must stay internal, including when replacing an old service.
  const ingress = z
    .object({
      rules: z
        .array(
          z.looseObject({
            component: z.looseObject({ name: z.string() }).optional(),
          })
        )
        .optional(),
    })
    .optional()
    .parse(spec.ingress)
  if (ingress?.rules?.some((rule) => rule.component?.name === 'design-renderer')) {
    throw new Error('Remove public renderer ingress before using the internal renderer deployment.')
  }
  const renderer = {
    name: 'design-renderer',
    // Reuse the existing public GHCR package; tags distinguish web and renderer.
    image: {
      registry_type: 'GHCR',
      registry: 'playbookmediallc',
      repository: 'screenshot-studio',
      digest: env.IMAGE_DIGEST,
    },
    internal_ports: [8080],
    instance_count: existing?.instance_count ?? 1,
    instance_size_slug: existing?.instance_size_slug ?? 'apps-s-1vcpu-2gb',
    health_check: {
      http_path: '/ready',
      port: 8080,
      initial_delay_seconds: 20,
      period_seconds: 10,
      timeout_seconds: 5,
      failure_threshold: 6,
    },
    liveness_health_check: {
      http_path: '/health',
      port: 8080,
      initial_delay_seconds: 30,
      period_seconds: 15,
      timeout_seconds: 5,
      failure_threshold: 3,
    },
    termination: { drain_seconds: 15, grace_period_seconds: 35 },
    envs: [
      runtimeEnv('RENDER_ALLOWED_ORIGIN', env.RENDER_ALLOWED_ORIGIN),
      runtimeEnv('RENDER_SERVICE_SECRET', env.PLATFORM_RENDER_SERVICE_SECRET, true),
      runtimeEnv('RENDER_CONCURRENCY', String(runtime.concurrency)),
      runtimeEnv('RENDER_MAX_QUEUE', String(runtime.maxQueue)),
      runtimeEnv('RENDER_QUEUE_TIMEOUT_MS', String(runtime.queueTimeoutMs)),
      runtimeEnv('RENDER_TIMEOUT_MS', String(runtime.timeoutMs)),
      runtimeEnv('RENDER_RECYCLE_AFTER', String(runtime.recycleAfter)),
    ],
  }
  web.envs = mergeEnv(web, [
    runtimeEnv('PLATFORM_DESIGN_RENDERER', 'enabled'),
    runtimeEnv('PLATFORM_RENDER_SERVICE_URL', 'http://design-renderer:8080'),
    runtimeEnv('PLATFORM_RENDER_SERVICE_SECRET', env.PLATFORM_RENDER_SERVICE_SECRET, true),
    runtimeEnv('PLATFORM_RENDER_BASE_URL', env.RENDER_ALLOWED_ORIGIN),
  ])
  const index = spec.services.findIndex((service) => service.name === 'design-renderer')
  if (index === -1) spec.services.push(renderer)
  else spec.services[index] = renderer
  return spec
}

export function verifyDeployment(input: unknown, expectedSpec: unknown, previousId?: string) {
  const expected = specSchema.parse(expectedSpec)
  const app = z
    .object({
      active_deployment: z.object({
        id: z.string(),
        phase: z.literal('ACTIVE'),
        spec: specSchema,
      }),
    })
    .parse(Array.isArray(input) ? input[0] : input)
  const active = app.active_deployment
  if (active.id === previousId) throw new Error('The active deployment has not changed.')
  for (const name of ['web', 'design-renderer']) {
    const actual = active.spec.services.find((service) => service.name === name)
    const wanted = expected.services.find((service) => service.name === name)
    if (!actual || !wanted) throw new Error(`Missing deployed component: ${name}`)
    const actualImage = z.object({ digest: z.string() }).parse(actual.image)
    const expectedImage = z.object({ digest: z.string() }).parse(wanted.image)
    if (actualImage.digest !== expectedImage.digest)
      throw new Error(`Unexpected image for ${name}.`)
  }
  return active.id
}
