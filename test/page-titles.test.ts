import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import test from 'node:test'

/**
 * The root layout's title template appends "| Shots", so a page
 * title that already ends with the brand renders it twice in the browser tab.
 * Pages that need the full string set `title: { absolute: ... }` instead.
 */

const ROOT = process.cwd()

function pageFiles(directory: string): string[] {
  return readdirSync(join(ROOT, directory)).flatMap((entry) => {
    const path = join(directory, entry)
    if (statSync(join(ROOT, path)).isDirectory()) return pageFiles(path)
    return /^(page|layout)\.tsx$/.test(entry) ? [relative(ROOT, join(ROOT, path))] : []
  })
}

function brandedTitles(source: string): string[] {
  return [...source.matchAll(/title:\s*(['`])([^'`]*\| Shots)\1/g)].map(
    (match) => match[2]
  )
}

test('page titles do not repeat the brand the layout template adds', () => {
  const files = pageFiles('app/[locale]')
  assert.ok(files.length > 20, 'the page scan found too few files to be meaningful')
  const offenders = files.flatMap((file) =>
    brandedTitles(readFileSync(join(ROOT, file), 'utf8')).map((title) => `${file}: ${title}`)
  )
  assert.deepEqual(offenders, [])
})

test('the title scan detects a doubled brand and allows absolute titles', () => {
  assert.deepEqual(
    brandedTitles("export const metadata = { title: 'Assets | Shots' }"),
    ['Assets | Shots']
  )
  assert.deepEqual(brandedTitles("{ title: { absolute: 'Campaign | Shots' } }"), [])
  assert.deepEqual(brandedTitles("{ title: 'Assets' }"), [])
})
