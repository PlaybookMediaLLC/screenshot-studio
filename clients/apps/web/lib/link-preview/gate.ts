import { issueSeveritySchema, type LinkPreview } from '@/lib/api/contracts/link-preview'
import { auditLinkPreview } from '@/lib/link-preview/audit'
import { linksInText } from '@/lib/link-preview/share'

/**
 * The publishing gate: before a post goes out, read every link in it and
 * report each one whose preview is broken. Takes the reader as an argument so
 * campaigns pass the SSRF-checked fetcher and tests pass a stub.
 */

/** Most links read per post; posts rarely carry more, and each read fetches several URLs. */
export const MAX_GATED_LINKS = 3

/** What reading one link returned: the preview, or why it could not be read. */
export type LinkReader = (
  url: string
) => Promise<{ ok: true; preview: LinkPreview } | { ok: false; reason: string }>

/** One sentence per link that would preview badly, naming its errors. Empty when every link is fine. */
export async function postLinkProblems(text: string, read: LinkReader): Promise<string[]> {
  const links = linksInText(text).slice(0, MAX_GATED_LINKS)
  const problems = await Promise.all(
    links.map(async (url) => {
      const result = await read(url)
      if (!result.ok) return [`${url} could not be read: ${result.reason}`]
      const errors = auditLinkPreview(result.preview).filter(
        (issue) => issue.severity === issueSeveritySchema.enum.error
      )
      return errors.length ? [`${url}: ${errors.map((issue) => issue.title).join('; ')}.`] : []
    })
  )
  return problems.flat()
}
