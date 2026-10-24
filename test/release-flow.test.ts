import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'

const { compareVersions, releaseNotes, publishPromotedRelease } = createRequire(import.meta.url)(
  '../scripts/release-flow.cjs'
)
const repository = 'PlaybookMediaLLC/screenshot-studio'
const notFound = () => Object.assign(new Error('Not found'), { status: 404 })
const changelog =
  '## [2.37.0](url) (2026-10-24)\n\n### Features\n\n* Approved change\n\n## 2.36.4\n\nOld change'

type FixtureOptions = {
  existing?: boolean
  tagSha?: string
  squash?: boolean
  fork?: boolean
  direct?: boolean
  sourceTree?: string
  latestVersion?: string
  cleanupFailure?: boolean
}

function fixture(options: FixtureOptions = {}) {
  const writes: Array<Record<string, unknown>> = []
  const cleanup: number[] = []
  const tagged: number[] = []
  const promotion = {
    merged_at: '2026-10-24T17:00:00Z',
    merge_commit_sha: 'main-sha',
    base: { ref: 'main' },
    head: { ref: 'develop', repo: { full_name: options.fork ? 'outsider/fork' : repository } },
  }
  const github = {
    paginate: async (method: () => Promise<unknown[]>) => method(),
    rest: {
      repos: {
        getCommit: async ({ ref }: { ref: string }) => ({
          data:
            ref === 'main-sha'
              ? {
                  parents: options.squash
                    ? [{ sha: 'base' }]
                    : [{ sha: 'base' }, { sha: 'promoted-sha' }],
                  commit: { tree: { sha: 'tree' } },
                }
              : { commit: { tree: { sha: options.sourceTree ?? 'tree' } } },
        }),
        listPullRequestsAssociatedWithCommit: async () => (options.direct ? [] : [promotion]),
        getReleaseByTag: async () => {
          if (!options.existing) throw notFound()
          return { data: { draft: false, prerelease: false } }
        },
        getLatestRelease: async () => ({ data: { tag_name: options.latestVersion ?? 'v2.36.4' } }),
        compareCommits: async ({ base }: { base: string }) => ({
          data: { status: base === 'future-sha' ? 'diverged' : 'ahead' },
        }),
        createRelease: async (input: Record<string, unknown>) => {
          writes.push(input)
        },
      },
      git: {
        getRef: async () => {
          const sha = options.tagSha ?? (options.existing ? 'promoted-sha' : null)
          if (!sha) throw notFound()
          return { data: { object: { type: 'commit', sha } } }
        },
      },
      issues: {
        listForRepo: async () => [
          { number: 10, pull_request: {} },
          { number: 11, pull_request: {} },
          { number: 12 },
        ],
        addLabels: async ({ issue_number }: { issue_number: number }) => {
          tagged.push(issue_number)
        },
        removeLabel: async ({ issue_number }: { issue_number: number }) => {
          if (options.cleanupFailure) throw new Error('Provider unavailable after publication')
          cleanup.push(issue_number)
        },
      },
      pulls: {
        get: async ({ pull_number }: { pull_number: number }) => ({
          data: {
            merged_at: '2026-10-24T16:00:00Z',
            base: { ref: 'develop' },
            head: {
              ref: 'release-please--branches--develop--components--screenshot-studio',
              repo: { full_name: repository },
            },
            merge_commit_sha: pull_number === 10 ? 'prepared-sha' : 'future-sha',
          },
        }),
      },
    },
  }
  const input = {
    github,
    context: {
      ref: 'refs/heads/main',
      sha: 'main-sha',
      repo: { owner: 'PlaybookMediaLLC', repo: 'screenshot-studio' },
    },
    core: { info: () => {} },
    version: '2.37.0',
    changelog,
  }
  return { input, writes, cleanup, tagged }
}

test('branch policy accepts work into develop and same-repository promotions only', () => {
  const workflow = readFileSync('.github/workflows/branch-policy.yml', 'utf8')
  const script = workflow
    .split('script: |\n')[1]
    .split('\n')
    .map((line) => line.slice(12))
    .join('\n')
  const evaluate = new Function('context', 'core', script)
  for (const [base, head, headRepo, allowed] of [
    ['develop', 'feature/a', repository, true],
    ['develop', 'fix/a', 'outsider/fork', true],
    ['main', 'develop', repository, true],
    ['main', 'feature/a', repository, false],
    ['main', 'develop', 'outsider/fork', false],
    ['main', 'release-please--branches--main', repository, false],
    ['upstream', 'feature/a', repository, false],
  ] as const) {
    const errors: string[] = []
    evaluate(
      {
        payload: {
          pull_request: {
            base: { ref: base, repo: { full_name: repository } },
            head: { ref: head, repo: { full_name: headRepo } },
          },
        },
      },
      { info: () => {}, setFailed: (message: string) => errors.push(message) }
    )
    assert.equal(errors.length === 0, allowed, `${headRepo}:${head} -> ${base}`)
  }
  assert.doesNotMatch(workflow, /actions\/checkout/)
})

test('release versions use numeric ordering and exact changelog sections', () => {
  assert.equal(compareVersions('2.10.0', '2.9.9'), 1)
  assert.equal(compareVersions('2.1.0', '2.1.0'), 0)
  assert.equal(releaseNotes(changelog, '2.37.0'), '### Features\n\n* Approved change')
  assert.throws(() => compareVersions('02.1.0', '2.1.0'))
  assert.throws(() => compareVersions('2.1.0-beta.1', '2.1.0'))
  assert.throws(() => releaseNotes(changelog, '3.0.0'))
})

test('publication pins the promoted commit and clears only included preparation PRs', async () => {
  const state = fixture()
  const result = await publishPromotedRelease(state.input)
  assert.deepEqual(result, { created: true, tag: 'v2.37.0', sha: 'promoted-sha' })
  assert.equal(state.writes[0].target_commitish, 'promoted-sha')
  assert.equal(state.writes[0].tag_name, 'v2.37.0')
  assert.equal(state.writes[0].body, '### Features\n\n* Approved change')
  assert.deepEqual(state.cleanup, [10])
})

for (const [name, options] of [
  ['direct main push', { direct: true }],
  ['fork named develop', { fork: true }],
  ['squashed promotion', { squash: true }],
  ['different promoted tree', { sourceTree: 'unreviewed-tree' }],
  ['version regression', { latestVersion: 'v3.0.0' }],
  ['conflicting existing tag', { tagSha: 'different-sha' }],
] as const) {
  test(`publication rejects ${name} before any release write`, async () => {
    const state = fixture(options)
    await assert.rejects(() => publishPromotedRelease(state.input))
    assert.deepEqual(state.writes, [])
    assert.deepEqual(state.cleanup, [])
  })
}

test('develop can prepare but cannot publish a release', async () => {
  const state = fixture()
  state.input.context.ref = 'refs/heads/develop'
  await assert.rejects(() => publishPromotedRelease(state.input), /only be published from main/)
  assert.deepEqual(state.writes, [])
})

test('retry after successful publication performs cleanup without recreating a release', async () => {
  const first = fixture({ cleanupFailure: true })
  await assert.rejects(() => publishPromotedRelease(first.input), /Provider unavailable/)
  assert.equal(first.writes.length, 1)
  assert.deepEqual(first.tagged, [10])
  const retry = fixture({ existing: true })
  assert.equal((await publishPromotedRelease(retry.input)).created, false)
  assert.deepEqual(retry.writes, [])
  assert.deepEqual(retry.cleanup, [10])
})

test('an existing tag outside promoted history fails without cleanup', async () => {
  const state = fixture({ existing: true, tagSha: 'future-sha' })
  await assert.rejects(() => publishPromotedRelease(state.input), /published ancestor/)
  assert.deepEqual(state.cleanup, [])
})
