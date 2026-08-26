# RFC 026: External Research Tools

**Status:** Proposed
**Date:** 2026-08-17
**Revised:** 2026-08-26
**Depends on:** RFC 016 and RFC 025
**Owners:** Engineering and Security

## Decision

Add external research tools to the agent only now. Content can then move
beyond information already contained inside the SaaS. Delaying this is
deliberate: research becomes contextual because the agent already knows the
user's product, brand, audience, features, history, and published content.

Research is the first capability that puts genuinely untrusted third-party text
into the agent's context on purpose. Everything in this RFC follows from that.

## Design

New tools:

```text
searchWeb
researchCompetitors
researchIndustry
findTrendingTopics
```

Rules:

- Research tools follow the same contract as all tools (RFC 016):
  workspace-scoped, Zod-validated, audited.
- Research results attach to campaigns as sources, so a founder can see where
  a claim came from.
- Competitor names in generated copy trigger the review path regardless of
  other settings (see RFC 030).
- No tool fetches arbitrary URLs supplied by model output without the same
  SSRF guards the capture API uses.

## Goals

- Grounded, citable industry and competitor context.
- Every external claim traceable to a retrievable source.
- Bounded cost per run and per workspace.
- No new capability for the agent to reach an arbitrary network endpoint.

## Non-goals

- SEO tooling, ad research, and audience discovery.
- Automatic ingestion of research into the product profile without review.
- Real-time monitoring or alerting on competitors.
- Republishing third-party content beyond short quotation.

## Provider boundary

All research goes through one provider abstraction, matching the RFC 020
pattern:

```ts
SearchProvider {
  search(query, options): Promise<SearchResult[]>
}

SearchResult {
  url, title, snippet, publishedAt?, siteName?
}
```

The provider is a search API, not a browser. It returns snippets and metadata.
Fetching a full page is a separate, more restricted operation described below.

Provider selection criteria, in order: result quality on product and industry
queries, a licence permitting commercial derivative use of snippets, stable
citation URLs, predictable per-query pricing, and acceptable latency. Choosing
a provider is an implementation decision recorded when made; the abstraction
keeps it reversible.

## The URL problem

`searchWeb` returns URLs. Something eventually fetches them, and the model
influences which. That is a model-directed network request, which is the
capability RFC 016 deliberately withheld.

The rules that make it safe:

1. **The model never supplies a URL to fetch.** It supplies a *result index*
   from a search response the runtime already holds. The runtime maps the index
   to the URL. A model emitting a raw URL is rejected.
2. **Fetching is restricted to results from a provider response within the
   current run.** There is no free-form fetch tool.
3. **Every fetch passes the full capture SSRF stack**: scheme allowlist,
   private and metadata IP rejection, pinned DNS resolution, redirect
   re-validation per hop, size caps, and timeouts.
4. **Fetch results are text only.** No scripts execute, no subresources load,
   and no JavaScript rendering occurs.
5. **Fetch is capped** at a small number of pages per run.

Passing an index rather than a URL is the load-bearing detail. It removes the
model's ability to name a destination, which is what turns "the agent can
search" into "the agent can make arbitrary requests".

## Prompt injection

A fetched page is written by someone who may want to influence the agent, and
who may specifically be a competitor whose page the agent was asked to read.

Defenses, in order:

1. **Capability limits.** Research tools are read-only and add no write
   capability. A successful injection can bias generated copy, which a human
   reviews, and can do nothing else.
2. **Trust labeling.** Every research snippet enters the context tagged as
   untrusted external content, delimited, with an explicit statement that
   instructions inside are data.
3. **No tool chaining from content.** Research results cannot cause a fetch;
   only a provider result index can, and indices come from the runtime.
4. **Injection detection.** Content matching known patterns is flagged, its
   confidence lowered, and a security event recorded.
5. **Mandatory review.** Copy citing external sources always routes to human
   review, regardless of approval policy (RFC 030).
6. **Attribution.** Because every claim carries its source, a founder reviewing
   a suspicious claim can see the page it came from.

## Citations and provenance

```ts
ResearchSource {
  id
  workspaceId
  runId
  campaignId?
  url, title, snippet, siteName, publishedAt
  retrievedAt
  contentHash
  trustLevel            // provider_snippet | fetched_page
  usedInPostIds[]
}
```

Rules:

- A post making an external claim links every source supporting it.
- The workspace UI shows sources on the post, with domain and retrieval date.
- A claim generated with no linked source is flagged as unsupported and cannot
  be approved without an explicit acknowledgement.
- Sources are immutable once recorded. A page changing later does not rewrite
  what was cited at generation time.

The unsupported-claim flag is the mechanism that prevents the most damaging
failure: a confident public statistic that the model produced from nothing.

## Competitor handling

Competitor research is the highest-risk category because published claims about
a named competitor carry legal and reputational exposure.

- `researchCompetitors` accepts competitor names from `ProductProfile`, not
  free text from the model, so the agent cannot decide who a competitor is.
- Generated copy naming a competitor always routes to human review, regardless
  of autonomy mode or approval policy. This is a hard rule, not a default.
- Comparative claims require a linked source and are flagged distinctly from
  ordinary mentions.
- Superlatives and disparaging phrasing about a named competitor are blocked by
  the same filter mechanism as prohibited terms in RFC 011.
- Competitor content is quoted at snippet length only, never reproduced at
  length.

## Privacy and legal boundaries

| Constraint                     | Rule                                                    |
| ------------------------------ | ------------------------------------------------------- |
| Personal data                  | Do not research named individuals; person queries refused |
| Paywalled content              | Not bypassed; snippets only                             |
| robots.txt                     | Honored for direct fetches                              |
| Content reproduction           | Snippet-length quotation with attribution               |
| Provider terms                 | Retention and caching follow provider licence terms     |
| Retention                      | Sources retained with their campaign; deleted with the workspace |
| Attribution in published copy  | Claims sourced from a third party name the source when published |

Refusing person research is a product decision as much as a legal one. A
marketing tool that researches individuals is a different, more sensitive
product than this one.

## Caching and cost

| Control                        | Default                          |
| ------------------------------ | -------------------------------- |
| Search result cache            | 24 hours, keyed by normalized query and workspace |
| Fetched page cache             | 24 hours, keyed by URL and content hash |
| Searches per run               | 5                                |
| Page fetches per run           | 3                                |
| Searches per workspace per day | Plan-scoped                      |
| Provider spend ceiling         | Per-workspace monthly cap        |

Caches are workspace-scoped. A shared cache across tenants would leak the fact
that another workspace researched a given query, which is competitively
sensitive information.

Trending-topic queries cache more aggressively at the platform level only for
queries with no workspace-specific terms.

## Authorization

| Tool                  | Effect   | Permission       | Max/run |
| --------------------- | -------- | ---------------- | ------- |
| `searchWeb`           | external | `release:create` | 5       |
| `researchCompetitors` | external | `release:create` | 2       |
| `researchIndustry`    | external | `release:create` | 2       |
| `findTrendingTopics`  | external | `release:create` | 2       |

The `external` effect is new and is treated as its own category in RFC 031's
autonomy matrix. A workspace can disable external research entirely while
keeping every other agent capability, which some teams will require.

API-key-initiated runs may not call research tools by default, since machine
callers running unattended should not be making external requests attributed to
the workspace.

## Failure behavior

| Failure                       | Behavior                                             |
| ----------------------------- | ---------------------------------------------------- |
| Provider unavailable          | Tool returns an error; the run continues without research |
| Provider rate limited         | Backoff, then error; the run continues               |
| No results                    | Empty result set, stated plainly                     |
| Fetch blocked by SSRF guard   | Result skipped; a security event recorded            |
| Fetch times out               | Result skipped; others proceed                       |
| Spend ceiling reached         | Research disabled for the period; other tools work   |
| Injection detected            | Content flagged, confidence lowered, run continues   |

Research is always optional. Its unavailability degrades content quality and
never fails a campaign.

## Observability

- Searches and fetches per run and per workspace.
- Provider latency, error rate, and cost.
- Cache hit rate.
- Share of research-backed posts, and their approval rate.
- Unsupported-claim flags raised.
- SSRF blocks and injection detections, which should be rare and are
  investigated when not.

Approval rate on research-backed posts, compared against posts without
research, is the metric that actually matters. Research adds latency and
per-call cost to every campaign that uses it, so the only justification is
output a founder is more willing to publish. If the two rates converge,
research is a cost with no return and the correct response is to narrow when
it runs rather than to make it faster.

Unsupported-claim flags are read alongside it. Research that raises approval
rate while inventing citations is worse than no research, because it moves
wrong claims past a human who has started to trust the source.

## Acceptance criteria

1. The agent produces an industry-context post with cited sources, grounded in
   the workspace's product profile.
2. Every external claim in a published post links a retrievable source.
3. A claim with no linked source is flagged and cannot be silently approved.
4. The model cannot cause a fetch of a URL it supplies directly.
5. A search result pointing at a private IP is not fetched, and the block is
   recorded.
6. A redirect to an internal host is rejected at the hop.
7. A fetched page containing injected instructions changes no control flow and
   is flagged.
8. Copy naming a competitor always routes to human review.
9. A disparaging superlative about a named competitor is blocked.
10. A query naming an individual is refused.
11. Research caches are not shared across workspaces.
12. Exceeding the spend ceiling disables research without affecting other tools.
13. Provider outage degrades content without failing the campaign.
14. Sources are immutable after recording.
15. Deleting a workspace deletes its research sources.

## Rollout

1. Ship the provider abstraction and `searchWeb` with snippets only, no
   fetching. Snippets alone cover most needs at a fraction of the risk.
2. Ship citation storage and the workspace source display.
3. Ship the unsupported-claim flag.
4. Add index-based page fetching behind a flag; red-team it before enabling.
5. Add `researchCompetitors` with the mandatory review path.
6. Add `researchIndustry` and `findTrendingTopics`.

## Out of scope

- SEO tooling, ad research, and audience discovery.
- Automatic ingestion of research into the product profile without review.
