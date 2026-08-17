# RFC 032: Background Onboarding Agent and ICP Extraction

**Status:** Proposed
**Date:** 2026-08-17
**Depends on:** RFC 011 and RFC 012
**Owners:** Product and Engineering

## Decision

Implement URL onboarding as a two-speed pipeline: a fast synchronous path that
returns a usable profile in seconds, and a background agent that deepens it
over minutes. Extract an explicit Ideal Customer Profile, not only a product
description. Model the structure on the Founder Inbox codebase
(`Oppulence-Engineering/cossistant`), which ships this pattern in production
form.

This RFC refines the pipeline design of RFC 012. The `ProductProfile` data
model from RFC 012 stands. This RFC adds the ICP object, the execution
architecture, and the progress model.

## Prior art

The cossistant fork implements website → agent onboarding with these pieces:

| Piece           | Location                                                     | What it does                                                                                                                          |
| --------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Crawler service | `apps/api/src/services/firecrawl.ts`                         | One class wraps the crawl vendor: scrape, site map, batch scrape, crawl status, cancel, brand extraction                              |
| Fast path       | `apps/api/src/trpc/routers/ai-agent.ts` `generateBasePrompt` | Scrape one page and map the site in parallel. Generate the agent prompt in one request                                                |
| Crawl worker    | `apps/workers/src/queues/web-crawl/`                         | Background crawl writes knowledge rows. A Redis slot lease caps concurrent crawls. Plan limits apply in the worker                    |
| Training worker | `apps/workers/src/queues/ai-training/worker.ts`              | Embeds knowledge into chunks. Content hashes skip unchanged items. Orphaned chunks get deleted                                        |
| Status model    | `apps/api/src/db/schema/ai-agent.ts`                         | `trainingStatus`, `trainingProgress`, `trainingError`, `onboardingCompletedAt` live on the agent row. Realtime events stream progress |

Patterns we adopt directly:

1. **Two speeds.** The user sees value in seconds. Depth arrives in minutes.
2. **One vendor wrapper.** All crawler calls go through one service class. The
   vendor stays swappable.
3. **Manual beats scraped.** A user-typed description always wins over
   extracted content. Extracted values fill only empty fields.
4. **Cache on scrape.** A one-hour `maxAge` on scrapes makes page refreshes
   during onboarding free.
5. **Status on the domain object.** Progress, error, and completion timestamps
   live on the profile row. The UI polls or subscribes; it never inspects jobs.
6. **Incremental re-analysis.** Content hashes per source. Re-runs process only
   changed pages.
7. **Fallbacks everywhere.** Extraction failure degrades to a default profile
   plus a manual form. Onboarding never blocks on the crawler.

## Design

### Fast path (synchronous, under ~10 seconds)

```text
URL submitted
   ↓
scrape homepage + map site        (parallel, cached)
   ↓
extract brand info                (name, description, logo, favicon, keywords)
   ↓
seed BrandProfile draft           (RFC 011)
   ↓
one LLM call → ProductProfile draft + ICP draft
   ↓
return drafts + discovered page count
```

The user lands on a review screen with a filled-in profile, not a spinner.

### Background agent (asynchronous, minutes)

```text
OnboardingRun created
   ↓
crawl discovered pages            (pricing, features, docs, changelog)
   ↓
store PageKnowledge rows          (one per page, content-hashed)
   ↓
classify → enrich ProductProfile
   ↓
derive IdealCustomerProfile       (personas, pains, buying triggers)
   ↓
seed ProductSurfaces              (RFC 013)
   ↓
mark run complete
```

Execution maps to our stack:

| cossistant                       | screenshot-studio                                         |
| -------------------------------- | --------------------------------------------------------- |
| BullMQ queues + Redis slot lease | Trigger.dev tasks (RFC 004) with queue concurrency limits |
| `emitToWebsite` realtime events  | Progress fields on `OnboardingRun`, polled by the UI      |
| Drizzle schema                   | Prisma models                                             |
| Plan checks in the worker        | Same hook; quota enforcement arrives with the billing RFC |

### Data model

```ts
OnboardingRun {
  id
  workspaceId
  url
  status        // queued | crawling | classifying | completed | failed
  progress      // 0-100
  error
  startedAt
  completedAt
}

PageKnowledge {
  id
  workspaceId
  url
  title
  contentHash
  markdown
  category      // homepage | pricing | features | docs | changelog | other
}

IdealCustomerProfile {
  id
  workspaceId
  personas[]    // { role, seniority, teamSize }
  industries[]
  companySize
  pains[]
  buyingTriggers[]
  objections[]
  wateringHoles[]   // channels where the ICP reads and posts
  toneGuidance
}
```

The ICP feeds copy generation (RFC 015), channel selection (RFC 020), and
content pillars (RFC 025). Every field is editable. Manual edits set a flag
that blocks background overwrite.

## Exit criteria

1. A pasted URL returns a reviewable ProductProfile and ICP draft in under
   ten seconds.
2. The background run enriches both within a few minutes and reports progress
   the whole way.
3. A re-run on an unchanged site processes zero pages.
4. Crawler failure still yields a completed onboarding through manual entry.

## Out of scope

- Authenticated page capture. That gap needs its own RFC.
- Continuous re-crawling. GitHub events (RFC 022) update product context.
- Embedding-based retrieval over PageKnowledge. Classification reads pages
  directly at this scale.
