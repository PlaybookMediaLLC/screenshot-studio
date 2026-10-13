// Repeatable container load smoke: npm run test:load -- <built-image>
// Synthetic canvas workload, not a production editor capacity guarantee.
import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { promisify } from 'node:util'
import { setTimeout as delay } from 'node:timers/promises'
import { renderResultSchema } from '../src/schemas.js'
import { z } from 'zod'

const exec = promisify(execFile)
const clients = z.coerce
  .number()
  .int()
  .min(1)
  .max(32)
  .default(6)
  .parse(process.env.RENDER_LOAD_CLIENTS)
const image = process.argv[2] ?? 'playbook-design-renderer:multiuser'
const name = `renderer-load-${process.pid}`
const secret = 'load-test-only-secret-0123456789-abcdef'
const fixture = createServer((_, response) =>
  response.end(`<!doctype html><script>
window.__designReady = true;
window.__exportDesign = async () => {
  const canvas = document.createElement('canvas');
  canvas.width = 2400; canvas.height = 1350;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 2400, 1350);
  gradient.addColorStop(0, '#164e63'); gradient.addColorStop(1, '#f472b6');
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, 2400, 1350);
  ctx.font = '64px sans-serif'; ctx.fillStyle = 'white';
  for (let i = 0; i < 12; i++) ctx.fillText('Product launch ' + i, 120, 100 + i * 95);
  return { base64: canvas.toDataURL('image/png').split(',')[1], width: 2400, height: 1350, mediaType: 'image/png' };
};
</script>`)
)
await new Promise<void>((resolve) => fixture.listen(0, '0.0.0.0', resolve))
const appPort = (fixture.address() as AddressInfo).port
const reservation = createServer()
await new Promise<void>((resolve) => reservation.listen(0, '127.0.0.1', resolve))
const port = (reservation.address() as AddressInfo).port
await new Promise<void>((resolve) => reservation.close(() => resolve()))
const origin = `http://host.docker.internal:${appPort}`
const service = `http://127.0.0.1:${port}`
const container = spawn(
  'docker',
  [
    'run',
    '--rm',
    '--name',
    name,
    '--platform',
    'linux/amd64',
    '--cpus=1',
    '--memory=2g',
    '--add-host=host.docker.internal:host-gateway',
    '-p',
    `127.0.0.1:${port}:8080`,
    '-e',
    `RENDER_ALLOWED_ORIGIN=${origin}`,
    '-e',
    `RENDER_SERVICE_SECRET=${secret}`,
    image,
  ],
  { stdio: ['ignore', 'pipe', 'pipe'] }
)
let logs = ''
container.stdout.on('data', (chunk: Buffer) => {
  logs += chunk.toString()
})
container.stderr.on('data', (chunk: Buffer) => {
  logs += chunk.toString()
})
let monitoring = true
let peakMemoryBytes = 0
let peakActive = 0
let peakQueued = 0
let monitor: Promise<void> | undefined
try {
  let ready = false
  for (let attempt = 0; attempt < 120; attempt++) {
    ready = await fetch(`${service}/ready`, { signal: AbortSignal.timeout(2000) })
      .then((response) => response.ok)
      .catch(() => false)
    if (ready) break
    if (container.exitCode !== null) throw new Error(logs)
    await delay(500)
  }
  assert.ok(ready, logs)
  const { stdout: uid } = await exec('docker', ['exec', name, 'id', '-u'])
  assert.notEqual(uid.trim(), '0')
  monitor = (async () => {
    while (monitoring) {
      const [metrics, memory] = await Promise.all([
        fetch(`${service}/metrics`).then((response) => response.text()),
        exec('docker', ['exec', name, 'cat', '/sys/fs/cgroup/memory.current']),
      ])
      peakMemoryBytes = Math.max(peakMemoryBytes, Number(memory.stdout.trim()))
      peakActive = Math.max(peakActive, Number(metrics.match(/design_render_active (\d+)/)?.[1]))
      peakQueued = Math.max(peakQueued, Number(metrics.match(/design_render_queued (\d+)/)?.[1]))
      await delay(200)
    }
  })()
  const durations: number[] = []
  let busyResponses = 0
  const started = performance.now()
  await Promise.all(
    Array.from({ length: clients }, async (_, user) => {
      for (let iteration = 0; iteration < 10; iteration++) {
        const requestStart = performance.now()
        let response: Response | undefined
        for (let attempt = 0; attempt < 5; attempt++) {
          response = await fetch(`${service}/render`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-render-secret': secret },
            body: JSON.stringify({
              url: `${origin}/render/load?user=${user}&iteration=${iteration}`,
            }),
            signal: AbortSignal.timeout(75000),
          })
          if (response.status !== 503) break
          busyResponses += 1
          if (attempt === 4) break
          await response.text()
          await delay(5000 + user * 100)
        }
        assert.ok(response)
        assert.equal(response.status, 200, `${await response.clone().text()}\n${logs}`)
        const result = renderResultSchema.parse(await response.json())
        assert.equal(result.width, 2400)
        assert.equal(result.height, 1350)
        assert.equal(
          Buffer.from(result.base64, 'base64').subarray(0, 8).toString('hex'),
          '89504e470d0a1a0a'
        )
        durations.push(performance.now() - requestStart)
      }
    })
  )
  const elapsed = performance.now() - started
  monitoring = false
  await monitor
  assert.ok(peakActive <= 2, `Too many active contexts: ${peakActive}`)
  assert.equal((await fetch(`${service}/ready`)).status, 200)
  durations.sort((a, b) => a - b)
  process.stdout.write(
    JSON.stringify(
      {
        image,
        renders: durations.length,
        concurrentClients: clients,
        busyResponses,
        cpuLimit: 1,
        memoryLimitMiB: 2048,
        elapsedSeconds: +(elapsed / 1000).toFixed(2),
        rendersPerSecond: +(durations.length / (elapsed / 1000)).toFixed(2),
        p50Ms: Math.round(durations[Math.floor(durations.length * 0.5)]!),
        p95Ms: Math.round(durations[Math.floor(durations.length * 0.95)]!),
        peakMemoryMiB: Math.round(peakMemoryBytes / 1024 / 1024),
        peakActive,
        peakQueued,
      },
      null,
      2
    ) + '\n'
  )
} finally {
  monitoring = false
  await monitor?.catch(() => undefined)
  await exec('docker', ['stop', '-t', '35', name]).catch(() => undefined)
  fixture.closeAllConnections()
  fixture.close()
}
