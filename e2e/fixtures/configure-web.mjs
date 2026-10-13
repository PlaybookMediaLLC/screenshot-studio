import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'

const mode = process.argv[2]
if (!['gate', 'restore'].includes(mode)) {
  throw new Error(
    'Usage: node e2e/fixtures/configure-web.mjs gate|restore [private-bootstrap-file]'
  )
}
const env = { ...process.env }
if (mode === 'gate') {
  const input = process.argv[3]
  if (!input) throw new Error('Gate mode requires the private bootstrap file')
  const { apiKey } = JSON.parse(await readFile(input, 'utf8'))
  if (!apiKey) throw new Error('Go API key is missing')
  env.POSTIZ_API_KEY_SOCIAL_GATE = apiKey
  env.POSTIZ_API_URL = 'http://host.docker.internal:3110/public/v1'
} else {
  delete env.POSTIZ_API_KEY_SOCIAL_GATE
  delete env.POSTIZ_API_URL
}
const command = [
  'compose',
  '--env-file',
  '.local/dev.env',
  '--file',
  'compose.yaml',
  ...(env.E2E_DOCKER_HOST_GATEWAY === 'true' ? ['--file', 'compose.ci.yaml'] : []),
  'up',
  '--detach',
  '--no-build',
  '--no-deps',
  '--force-recreate',
  'app',
]
const result = spawnSync('docker', command, { env, stdio: 'inherit' })
if (result.status !== 0) process.exit(result.status ?? 1)
