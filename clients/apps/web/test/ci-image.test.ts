import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

const require = createRequire(import.meta.url)
const { waitForImage } = require('../../../../dev/ci-image.cjs') as {
  waitForImage: (input: object) => Promise<void>
}

type Artifact = { id: number; name: string; expired: boolean }
type Job = { name: string; status: string; conclusion?: string }

function scenario(artifacts: Artifact[][], jobs: Job[]) {
  let polls = 0
  let sleeps = 0
  let output = ''
  const listArtifacts = Symbol('artifacts')
  const listJobs = Symbol('jobs')
  return {
    result: () => ({ polls, sleeps, output }),
    input: {
      context: { repo: { owner: 'owner', repo: 'shots' }, runId: 42, sha: 'abc' },
      core: {
        setOutput: (key: string, value: string) => {
          assert.equal(key, 'name')
          output = value
        },
      },
      sleep: async (ms: number) => {
        assert.equal(ms, 10_000)
        sleeps++
      },
      github: {
        rest: {
          actions: { listWorkflowRunArtifacts: listArtifacts, listJobsForWorkflowRun: listJobs },
        },
        paginate: async (endpoint: symbol, args: Record<string, unknown>) => {
          assert.equal(args.run_id, 42)
          assert.equal(args.owner, 'owner')
          assert.equal(args.repo, 'shots')
          if (endpoint === listArtifacts) return artifacts[Math.min(polls++, artifacts.length - 1)]
          assert.equal(endpoint, listJobs)
          assert.equal(args.filter, 'latest')
          return jobs
        },
      },
    },
  }
}

test('waits for the same run and SHA while setup overlaps a running build', async () => {
  const run = scenario(
    [[], [{ id: 2, name: 'ci-web-abc-1', expired: false }]],
    [{ name: 'Build web image', status: 'in_progress' }]
  )
  await waitForImage(run.input)
  assert.deepEqual(run.result(), { polls: 2, sleeps: 1, output: 'ci-web-abc-1' })
})

test('failed-job reruns reuse the latest unexpired image for this exact SHA', async () => {
  const run = scenario(
    [
      [
        { id: 5, name: 'ci-web-other-1', expired: false },
        { id: 4, name: 'ci-web-abc-3', expired: true },
        { id: 2, name: 'ci-web-abc-1', expired: false },
        { id: 3, name: 'ci-web-abc-2', expired: false },
      ],
    ],
    []
  )
  await waitForImage(run.input)
  assert.equal(run.result().output, 'ci-web-abc-2')
})

test('upload completing between the artifact and job queries is not a build failure', async () => {
  const run = scenario(
    [[], [{ id: 2, name: 'ci-web-abc-1', expired: false }]],
    [{ name: 'Build web image', status: 'completed', conclusion: 'success' }]
  )
  await waitForImage(run.input)
  assert.deepEqual(run.result(), { polls: 2, sleeps: 0, output: 'ci-web-abc-1' })
})

for (const conclusion of ['failure', 'cancelled', 'skipped', 'success']) {
  test(`a completed ${conclusion} build without its artifact fails immediately`, async () => {
    const run = scenario([[]], [{ name: 'Build web image', status: 'completed', conclusion }])
    await assert.rejects(waitForImage(run.input), /without an available image artifact/)
    assert.equal(run.result().sleeps, 0)
  })
}

test('a missing or stalled producer cannot wait forever', async () => {
  const run = scenario([[]], [])
  await assert.rejects(waitForImage(run.input), /Timed out after 20 minutes/)
  assert.equal(run.result().polls, 120)
})

test('API errors propagate instead of masquerading as a pending build', async () => {
  const run = scenario([[]], [])
  run.input.github.paginate = async () => {
    throw new Error('API unavailable')
  }
  await assert.rejects(waitForImage(run.input), /API unavailable/)
})
