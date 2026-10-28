import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

test('duration report counts retry setup, ranks total cost, and preserves flaky status', () => {
  const dir = mkdtempSync(join(tmpdir(), 'e2e-durations-'))
  const setup = (ms: number) => [{ type: 'setup-ms', description: String(ms) }]
  try {
    const file = join(dir, 'results-production.json')
    writeFileSync(
      file,
      JSON.stringify({
        stats: { duration: 450_000 },
        suites: [
          {
            suites: [
              {
                specs: [
                  {
                    file: 'a.spec.ts',
                    line: 1,
                    title: 'retried',
                    tests: [
                      {
                        status: 'flaky',
                        annotations: setup(20_000),
                        results: [
                          { duration: 100_000, status: 'failed', annotations: setup(10_000) },
                          { duration: 200_000, status: 'passed', annotations: setup(20_000) },
                        ],
                      },
                    ],
                  },
                  {
                    file: 'b.spec.ts',
                    line: 2,
                    title: 'single',
                    tests: [
                      {
                        status: 'expected',
                        annotations: setup(25_000),
                        results: [{ duration: 250_000, status: 'passed' }],
                      },
                    ],
                  },
                  {
                    file: 'c.spec.ts',
                    line: 3,
                    title: 'skipped',
                    tests: [
                      {
                        status: 'skipped',
                        results: [{ duration: 0, status: 'skipped' }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      })
    )
    const output = execFileSync(process.execPath, ['scripts/e2e-durations.mjs', file], {
      encoding: 'utf8',
    })
    assert.match(output, /Time in tests, with retries \| 550.0 s/)
    assert.match(output, /Retry overhead \| 100.0 s/)
    assert.match(output, /Setup share of test time \| 10%/)
    assert.match(output, /results-production.json: 450.0 s/)
    assert.match(output, /retried \| 300.0 s \| 30.0 s \| 2 \| flaky/)
    assert.ok(output.indexOf('retried |') < output.indexOf('single |'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
