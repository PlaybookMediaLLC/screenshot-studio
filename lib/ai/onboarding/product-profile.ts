import 'server-only'

import { withAiCredits } from '@/lib/ai/metering'
import { PRODUCT_PROFILE_INSTRUCTIONS } from '@/lib/ai/launch/prompts'
import { runSubmitStage } from '@/lib/ai/launch/run'
import { type LinkPreview, linkPreviewAgentSchema } from '@/lib/api/contracts/link-preview'
import type { TenantContext } from '@/lib/auth/access'
import { allowedTestHosts, safeFetchText } from '@/lib/launch/safe-fetch'
import { clampText, defuseMarkup } from '@/lib/launch/sanitize'
import { collectReleaseSources } from '@/lib/launch/sources'
import { readLinkPreview, readSitemap } from '@/lib/link-preview/fetch'
import { pickTopPages } from '@/lib/onboarding/pages'
import {
  type DraftSource,
  draftIssues,
  draftToUpsert,
  productProfileDraftSchema,
} from '@/lib/onboarding/profile-draft'
import { type StoredProductProfile, upsertProductProfile } from '@/lib/tenant/product-profile'
import { productProfileSourceSchema } from '@/lib/tenant/product-profile-schema'

/**
 * The onboarding fast path (docs/rfcs/032-background-onboarding-agent.md):
 * read the homepage and the sitemap in parallel, read the best few pages,
 * and make one model call that turns them into a cited product profile. The
 * call has no tools but its submit tool, and every page is fenced as
 * untrusted data. When discovery or the model runs out of time, the profile
 * falls back to the homepage's metadata, so onboarding never blocks on it.
 */

/** The whole read, start to finish. */
const BUDGET_MS = 20_000
/** Homepage and sitemap, in parallel. */
const DISCOVERY_MS = 7_000
const PAGE_TIMEOUT_MS = 5_000
/** Pages read besides the homepage. */
const TOP_PAGES = 4
const MIN_MODEL_MS = 3_000

/** What reading a site produced: a saved profile, or why the site could not be read. */
export type SiteReadOutcome =
  | {
      /** Whether the model described the product, not only the page metadata. */
      extracted: boolean
      ok: true
      /** The pages read besides the homepage; the first campaign cites them. */
      pages: string[]
      profile: StoredProductProfile
    }
  | { ok: false; reason: string }

const tooSlow = {
  ok: false as const,
  reason: 'The site took too long to respond.',
  status: 'failed' as const,
}

function within<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms)
  })
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer))
}

/** A profile from the homepage's own metadata, for when the model could not help. */
function metadataFields(preview: LinkPreview, url: string) {
  const title = preview.ogSiteName || preview.title?.split(/\s[|–—-]\s/)[0] || ''
  const summary = preview.ogDescription || preview.description || ''
  return {
    name: clampText(title.trim() || new URL(url).hostname, 160),
    sourceUrls: { name: url, ...(summary ? { summary: url } : {}) },
    url,
    ...(summary ? { summary: clampText(summary.trim(), 2_000) } : {}),
  }
}

/**
 * Read a product's site and save what it says as the workspace's product
 * profile, as an automated change: fields a person edited are kept.
 */
export async function readProductSite(
  tenant: TenantContext,
  input: { sentence?: string; url: string }
): Promise<SiteReadOutcome> {
  const deadline = Date.now() + BUDGET_MS
  const [read, sitemap] = await Promise.all([
    within(readLinkPreview(input.url, linkPreviewAgentSchema.enum.default), DISCOVERY_MS, tooSlow),
    within(readSitemap(input.url), DISCOVERY_MS, tooSlow),
  ])
  if (!read.ok) return { ok: false, reason: read.reason }
  const homepage = read.preview.url
  const pages = pickTopPages(homepage, sitemap.ok ? sitemap.urls : [], {
    limit: TOP_PAGES,
    robotsTxt: read.preview.robotsTxt,
  })

  const sentence = input.sentence?.trim() ?? ''
  const collected = await collectReleaseSources(
    {
      answers: [],
      audience: null,
      benefitStatement: sentence,
      description: null,
      productName: null,
      productUrl: homepage,
      sourceUrls: pages,
      title: 'Product site',
    },
    (url, headers) =>
      safeFetchText(url, {
        allowedPrivateHosts: allowedTestHosts(),
        headers,
        timeoutMs: PAGE_TIMEOUT_MS,
      })
  )
  const sources: DraftSource[] = collected.sources.map(({ flagged, id, status, url }) => ({
    flagged,
    id,
    status,
    url,
  }))
  const flagged = sources.filter((source) => source.flagged).map((source) => source.id)
  const citable = [...(sentence ? ['brief'] : []), ...collected.knownIds]
  const prompt = [
    [
      '<brief id="brief" trust="trusted">',
      `Product URL: ${homepage}`,
      sentence ? `In the founder's words: ${defuseMarkup(sentence)}` : null,
      '</brief>',
    ]
      .filter(Boolean)
      .join('\n'),
    collected.fenced
      ? `<sources>\n${collected.fenced}\n</sources>`
      : '<sources>None were readable.</sources>',
    flagged.length ? `Flagged (do not cite): ${flagged.join(', ')}.` : null,
    `You may cite: ${citable.join(', ') || 'nothing; leave every text empty but the name'}.`,
    'Describe the product.',
  ]
    .filter(Boolean)
    .join('\n\n')

  const run = await withAiCredits(tenant, () =>
    runSubmitStage({
      abortSignal: AbortSignal.timeout(Math.max(MIN_MODEL_MS, deadline - Date.now())),
      description:
        'Submit the product profile. Every value cites "brief" or a readable, unflagged source ' +
        'id. Returns problems to fix if any citation is invalid.',
      maxSteps: 3,
      prompt,
      role: 'drafting',
      schema: productProfileDraftSchema,
      system: PRODUCT_PROFILE_INSTRUCTIONS,
      toolName: 'submitProductProfile',
      validate: (draft) => draftIssues(draft, sources, Boolean(sentence)),
    })
  ).catch((error: unknown) => {
    // A slow or failing model leaves the metadata profile and the manual form.
    console.error('Product profile extraction failed.', {
      reason: error instanceof Error ? error.message : 'unknown',
    })
    return null
  })

  const fields = run?.value
    ? draftToUpsert(run.value, sources, homepage)
    : metadataFields(read.preview, homepage)
  const profile = await upsertProductProfile(tenant, {
    ...fields,
    source: productProfileSourceSchema.enum.automated,
  })
  return { extracted: Boolean(run?.value), ok: true, pages, profile }
}
