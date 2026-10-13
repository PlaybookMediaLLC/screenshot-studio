import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderSpec, verifyDeployment } from '../deploy/spec.js'

const digest = `sha256:${'a'.repeat(64)}`
const webDigest = `sha256:${'b'.repeat(64)}`
const env = {
  APP_ID: 'c525b0ba-b92a-4174-ae91-4ab4d7c92fd2',
  IMAGE_DIGEST: digest,
  RENDER_ALLOWED_ORIGIN: 'https://shots.oppulence.io',
  PLATFORM_RENDER_SERVICE_SECRET: 'test-render-secret-0123456789-abcdef',
}
const base = {
  id: env.APP_ID,
  spec: {
    name: 'screenshot-studio-production',
    ingress: { rules: [{ component: { name: 'web' }, match: { path: { prefix: '/' } } }] },
    services: [
      {
        name: 'web',
        image: { digest: webDigest },
        instance_count: 2,
        envs: [{ key: 'DATABASE_URL', value: 'EV[encrypted]', type: 'SECRET' }],
      },
      { name: 'storage', image: { digest: 'unchanged' }, internal_ports: [5000] },
    ],
    jobs: [{ name: 'web-migrate', image: { digest: webDigest } }],
    domains: [{ domain: 'shots.oppulence.io', type: 'PRIMARY' }],
  },
}

test('adds only an internal renderer and preserves existing platform configuration', () => {
  const original = structuredClone(base)
  const spec = renderSpec([base], env)
  assert.deepEqual(base, original)
  assert.deepEqual(spec.jobs, base.spec.jobs)
  assert.deepEqual(spec.domains, base.spec.domains)
  assert.deepEqual(spec.ingress, base.spec.ingress)
  assert.deepEqual(spec.services[1], base.spec.services[1])
  assert.deepEqual(spec.services[0]?.image, base.spec.services[0]?.image)
  assert.equal(spec.services[0]?.instance_count, 2)
  assert.deepEqual(spec.services[0]?.envs?.[0], base.spec.services[0]?.envs?.[0])
  const renderer = spec.services.find((service) => service.name === 'design-renderer')!
  assert.deepEqual(renderer.internal_ports, [8080])
  assert.equal(renderer.http_port, undefined)
  assert.equal(renderer.git, undefined)
  assert.deepEqual(renderer.image, {
    registry_type: 'GHCR',
    registry: 'playbookmediallc',
    repository: 'screenshot-studio',
    digest,
  })
  const webSecret = spec.services[0]?.envs?.find(
    (item) => item.key === 'PLATFORM_RENDER_SERVICE_SECRET'
  )
  const serviceSecret = renderer.envs?.find((item) => item.key === 'RENDER_SERVICE_SECRET')
  assert.equal(webSecret?.value, serviceSecret?.value)
  assert.equal(webSecret?.type, 'SECRET')
  assert.equal(serviceSecret?.type, 'SECRET')
})

test('repeated deployments replace the renderer without adding duplicate services or variables', () => {
  const spec = renderSpec(base, env)
  const again = renderSpec({ ...base, spec }, env)
  assert.deepEqual(again, spec)
})

test('refuses wrong apps, missing secrets, mutable image tags, and concurrent deployments', () => {
  assert.throws(() => renderSpec({ ...base, id: 'db01f48f-bde7-4a0a-9934-9d4130637697' }, env))
  assert.throws(() => renderSpec(base, { ...env, PLATFORM_RENDER_SERVICE_SECRET: '' }))
  assert.throws(() => renderSpec(base, { ...env, IMAGE_DIGEST: 'latest' }))
  assert.throws(() => renderSpec({ ...base, in_progress_deployment: { id: 'deploying' } }, env))
  assert.throws(() => renderSpec({ ...base, pending_deployment: { id: 'pending' } }, env))
})

test('refuses to preserve accidental public renderer ingress', () => {
  const input = structuredClone(base)
  input.spec.ingress.rules.push({
    component: { name: 'design-renderer' },
    match: { path: { prefix: '/renderer' } },
  })
  assert.throws(() => renderSpec(input, env), /public renderer ingress/)
})

test('verifies a new active deployment with the expected renderer and unchanged web image', () => {
  const spec = renderSpec(base, env)
  const deployment = { active_deployment: { id: 'new', phase: 'ACTIVE', spec } }
  assert.equal(verifyDeployment([deployment], spec, 'old'), 'new')
  assert.throws(() => verifyDeployment(deployment, spec, 'new'))
  const bad = structuredClone(deployment)
  bad.active_deployment.spec.services[0]!.image = { digest }
  assert.throws(() => verifyDeployment(bad, spec, 'old'), /Unexpected image for web/)
  assert.throws(() =>
    verifyDeployment(
      { active_deployment: { ...deployment.active_deployment, phase: 'ERROR' } },
      spec,
      'old'
    )
  )
})
