#!/usr/bin/env node
// Summarizes Playwright JSON reports as Markdown: how long the suite and each
// test take, how much of that is setup (the `setup-ms` annotations that
// framework/flow.ts records), retries, and the slowest tests. CI appends it to
// the job summary.
//
// Usage: node scripts/e2e-durations.mjs <report.json> [more reports...]
import { existsSync, readFileSync } from 'node:fs'

/** A test over this runs past the budget the test framework will enforce. */
const BUDGET_MS = 60_000
const SLOWEST = 20

const files = process.argv.slice(2).filter((file) => existsSync(file))
if (files.length === 0) {
  console.log('No Playwright JSON report was written.')
  process.exit(0)
}

function setupTime(annotations = []) {
  return annotations
    .filter((annotation) => annotation.type === 'setup-ms')
    .reduce((sum, annotation) => sum + Number(annotation.description), 0)
}

const tests = []
const reports = []
function collect(suite) {
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests ?? []) {
      const results = test.results ?? []
      const last = results.at(-1)
      if (!last) continue
      tests.push({
        attempts: results.length,
        duration: last.duration,
        name: `${spec.file}:${spec.line} › ${spec.title}`,
        setup: results.reduce(
          (sum, result, index) =>
            sum +
            setupTime(result.annotations ?? (index === results.length - 1 ? test.annotations : [])),
          0
        ),
        status: test.status ?? last.status,
        total: results.reduce((sum, result) => sum + result.duration, 0),
      })
    }
  }
  for (const child of suite.suites ?? []) collect(child)
}
for (const file of files) {
  const report = JSON.parse(readFileSync(file, 'utf8'))
  reports.push({ file, duration: report.stats?.duration ?? 0 })
  for (const suite of report.suites ?? []) collect(suite)
}

const seconds = (ms) => `${(ms / 1000).toFixed(1)} s`
const percentile = (values, p) => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]
}
const durations = tests.filter((test) => test.status !== 'skipped').map((test) => test.duration)
const setups = tests.map((test) => test.setup)
const total = tests.reduce((sum, test) => sum + test.total, 0)
const retried = tests.filter((test) => test.attempts > 1)
const overBudget = tests.filter((test) => test.duration > BUDGET_MS)

const lines = [
  '## End-to-end durations',
  '',
  '| Measure | Value |',
  '|---|---|',
  `| Tests | ${tests.length} |`,
  `| Time in tests, with retries | ${seconds(total)} |`,
  `| Retry overhead | ${seconds(tests.reduce((sum, test) => sum + test.total - test.duration, 0))} |`,
  `| Median test / p90 | ${seconds(percentile(durations, 50))} / ${seconds(percentile(durations, 90))} |`,
  `| Median setup / p90 | ${seconds(percentile(setups, 50))} / ${seconds(percentile(setups, 90))} |`,
  `| Setup share of test time | ${total ? Math.round((setups.reduce((a, b) => a + b, 0) / total) * 100) : 0}% |`,
  `| Retried tests | ${retried.length} |`,
  `| Tests over ${seconds(BUDGET_MS)} | ${overBudget.length} |`,
  '',
  '### Report wall time (includes Playwright setup and teardown)',
  '',
  ...reports.map((report) => `- ${report.file}: ${seconds(report.duration)}`),
  '',
  `### Slowest ${Math.min(SLOWEST, tests.length)} tests, including retries`,
  '',
  '| Test | Total time | Setup, all attempts | Attempts | Status |',
  '|---|---|---|---|---|',
  ...[...tests]
    .sort((a, b) => b.total - a.total)
    .slice(0, SLOWEST)
    .map(
      (test) =>
        `| ${test.name.replaceAll('|', '\\|')} | ${seconds(test.total)} | ${seconds(test.setup)} | ${test.attempts} | ${test.status} |`
    ),
]
console.log(lines.join('\n'))
