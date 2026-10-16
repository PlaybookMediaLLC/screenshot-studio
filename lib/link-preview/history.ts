import { z } from 'zod'
import type { LinkPreview, LinkPreviewIssue } from '@/lib/api/contracts/link-preview'
import { issueSeveritySchema } from '@/lib/api/contracts/link-preview'

/**
 * What changed on a page between checks: a small snapshot of the fields that
 * decide its preview, kept per URL, and the differences between two of them.
 */

/** One check, as remembered for comparison with the next. */
export const linkPreviewSnapshotSchema = z.object({
  at: z.number(),
  score: z.number(),
  errors: z.number(),
  warnings: z.number(),
  fields: z.record(z.string(), z.string()),
})

/** One of {@link linkPreviewSnapshotSchema}. */
export type LinkPreviewSnapshot = z.infer<typeof linkPreviewSnapshotSchema>

/** The fields whose changes are worth telling someone about. */
const TRACKED: Array<[string, (preview: LinkPreview) => string | undefined]> = [
  ['Title', (preview) => preview.title],
  ['Description', (preview) => preview.description],
  ['og:title', (preview) => preview.ogTitle],
  ['og:description', (preview) => preview.ogDescription],
  ['og:image', (preview) => preview.ogImage],
  ['twitter:card', (preview) => preview.twitterCard],
  ['twitter:image', (preview) => preview.twitterImage],
  ['Canonical', (preview) => preview.canonical],
  ['Robots', (preview) => preview.robots],
  ['Theme color', (preview) => preview.themeColor],
  [
    'Blocked crawlers',
    (preview) =>
      preview.crawlers
        ?.filter((access) => !access.allowed)
        .map((access) => access.crawler)
        .join(', ') || undefined,
  ],
]

/** A snapshot of `preview` as checked now. */
export function snapshotOf(
  preview: LinkPreview,
  score: number,
  issues: LinkPreviewIssue[],
  at = Date.now()
): LinkPreviewSnapshot {
  const fields: Record<string, string> = {}
  for (const [label, read] of TRACKED) {
    const value = read(preview)
    if (value) fields[label] = value
  }
  const count = (severity: LinkPreviewIssue['severity']) =>
    issues.filter((issue) => issue.severity === severity).length
  return {
    at,
    errors: count(issueSeveritySchema.enum.error),
    fields,
    score,
    warnings: count(issueSeveritySchema.enum.warning),
  }
}

/** Each tracked field that differs between two snapshots, in tracked order. */
export function snapshotChanges(before: LinkPreviewSnapshot, after: LinkPreviewSnapshot) {
  return TRACKED.map(([label]) => ({
    after: after.fields[label],
    before: before.fields[label],
    label,
  })).filter((change) => change.after !== change.before)
}
