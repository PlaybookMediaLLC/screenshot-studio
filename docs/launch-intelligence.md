# Launch intelligence: release → spec → plan → campaign

A campaign is only as good as its brief. This pipeline does the thinking that
turns a shipped release into a cited product spec and then into a complete,
on-brand launch campaign, with a human approving each stage.

```
release + sources ──► spec (cited) ──► plan ──► assets + copy ──► review ⟲ revise
        ▲                  ▲              ▲            ▲               │
        └──────────── team preferences (approved, rejected, revised) ◄─┘
```

Everything lives in fork-owned code: `lib/launch` (domain, pure where
possible), `lib/ai/launch` (model stages), `lib/trpc/routers/launch.ts`, and
`components/launch` plus the campaign sub-pages. No upstream editor file
changes.

## Stages

### 1. Sources

`lib/launch/sources.ts` collects what the release says about itself:

- **brief**: the release fields a person entered (title, why it matters,
  description, audience) and answered open questions. Trusted.
- **S1…S8**: each source link and the connected product URL, fetched with
  `lib/launch/safe-fetch.ts`. GitHub pull requests and releases are read
  through the GitHub API; everything else as HTML or text.

A release from a connected webhook or an API key has no author on the team, so
its brief is untrusted: it is fenced like a source, checked for prompt
injection, and listed with the sources so the reviewer sees any flags. GitHub
and GitLab release webhooks also link the release page (`html_url`, `url`) as
a source, so the spec reads the full notes, and keep only their opening as the
benefit statement.

Fetching is SSRF-safe: http(s) only, no credentials in URLs, the hostname and
every resolved address must be public (DNS-checked, so a public name that
resolves to a private address is refused), redirects are followed manually and
re-checked hop by hop, and responses are capped in size and time.

Fetched text is **untrusted data**. `lib/launch/sanitize.ts` strips scripts,
styles, comments, hidden elements and zero-width characters, flags text that
reads like instructions to an AI ("ignore previous instructions", "you are
now", role tags, requests to email or exfiltrate), and wraps each source in a
`<source id trust="untrusted">` block whose closing tags cannot be forged.
Flagged sources are shown to the reviewer; the model is told which are
flagged and that sources are evidence, never instructions.

### 2. Spec

`lib/ai/launch/spec.ts` drafts a structured spec (`releaseSpecSchema` in
`lib/launch/spec-schema.ts`):

| Section       | Contents                                        |
| ------------- | ----------------------------------------------- |
| summary       | one-paragraph overview                          |
| problem       | the pain, as cited claims                       |
| audience      | segments and their need                         |
| whatChanged   | what shipped                                    |
| capabilities  | named capabilities with descriptions            |
| beforeAfter   | before → after pairs                            |
| proofPoints   | evidence (only what the sources state)          |
| limitations   | what it does not do yet                         |
| faqs          | question and answer                             |
| messaging     | pillars, positioning against alternatives, CTAs |
| openQuestions | gaps the model would otherwise have to invent   |

Every claim cites `brief` or a source id. `lib/launch/citations.ts` checks the
citations after generation: a claim citing a source that does not exist, or
citing nothing, is removed and turned into an open question instead of being
kept. Specs are versioned (`ReleaseSpec`): each AI draft, human edit, or
applied revision is a new version; one version can be approved.

The model submits through a `submitSpec` tool rather than constrained JSON,
because the schema is richer than providers allow for structured output; the
tool validates and returns errors so the model corrects itself in the run.

### 3. Plan

`lib/ai/launch/plan.ts` turns the spec into a `CampaignPlan`: channels with
their role and cadence, angles tied to messaging pillars, an asset list
(hero, feature shot, social card, story) with format, the capability each
shows, its angle, and a capture hint (which page, which device, what to
focus on), and a timeline split into teaser, launch day, and follow-up.
Plans are versioned and approved like specs.

### 4. Produce

`lib/ai/launch/produce.ts` runs two agents side by side against the approved
(or latest) spec and plan:

- **Visuals** reuse the campaign studio tools. Designs are tagged with their
  plan asset key and variant label (A/B). The workspace's active brand kit
  is applied to every design (`lib/launch/brand.ts`: gradient from the brand
  background to the accent, brand text color, nearest catalog font). Every
  render is critiqued (`lib/ai/launch/critique.ts`) against the spec, the brand
  kit, and legibility before the agent may move on; a failing render is fixed
  and rendered again. The critique is stored on the design and shown on the
  asset board.
- **Copy** (`lib/ai/launch/copy.ts`) writes channel-native posts for X,
  LinkedIn, Product Hunt, a changelog entry, and an email announcement, several
  angles per channel, in the brand voice (`BrandProfile`). Each post lists the
  spec claims it relies on (`claims: [{ text, ref: "capabilities.0" }]`).
  `lib/launch/guards.ts` rejects posts that exceed channel limits, use
  prohibited or hype terms, include links that are not the product or a
  source, include email addresses, or cite claims the spec does not contain;
  the model gets the reasons and fixes the posts.

### 5. Review and revise

Reviewers approve, reject (with a note), or request changes on posts as
before. "Revise with AI" works on a spec section, a post, a design, or the
plan: `lib/ai/launch/revise.ts` produces a **proposal** (`CampaignRevision`)
with the new version of the target and, where a change affects other pieces
(a revised messaging pillar and the posts that cite it), consistency updates
for those too. The UI shows word diffs; nothing changes until the reviewer
applies the proposal, choosing which related updates to include.

### 6. Learning

`loadPreferenceExamples` (`lib/launch/store.ts`) and
`lib/launch/preferences-format.ts` assemble a `<team_preferences>` block for the
plan, copy, and revise stages from the workspace's own history: approved
posts per channel (write like these), rejected or changes-requested posts with
the reviewer's note (avoid these), and applied revisions (what reviewers asked
for, and the before and after). Retrieval is deterministic and scoped to the
workspace.

## Data model

| Model               | Purpose                                                                               |
| ------------------- | ------------------------------------------------------------------------------------- |
| `ReleaseSpec`       | versioned spec per release: content, source snapshot, origin, status                  |
| `CampaignPlan`      | versioned plan per campaign, built from a spec version                                |
| `CampaignRevision`  | a reviewer's comment, the AI proposal, and its outcome                                |
| `LaunchRun`         | one background AI run (spec, plan, produce, revision) and its result                  |
| `CampaignPost` (+)  | `title`, `phase`, `planItemKey`, `specVersion`, `planVersion`, `claims`, `reviewNote` |
| `Design` (+)        | `planAssetKey`, `variantLabel`, `planVersion`, `critique`                             |
| `CampaignAsset` (+) | `planAssetKey`, `variantLabel`, `planVersion`                                         |

Provenance ties each piece to the versions it came from: a post records the
spec and plan versions it was written against, and a visual records the plan
version and asset it fulfils. Applying a spec revision moves the posts that
were consistent with it to the new spec version; the boards mark visuals and
posts from an earlier plan so a replan never mixes silently with older work.

## Guardrails

- Tenant isolation: every query is scoped by organization; tools are built per
  run around one tenant and campaign, and capture only registered URLs.
- Quotas and limits: each AI action consumes one `generation:monthly` unit and
  is rate-limited per workspace (`LAUNCH_AI_RATE_LIMIT`).
- Audit: spec, plan, production, and revision actions write audit events with
  model id and usage.
- Untrusted input: sources are sanitized, flagged, and fenced; stages that read
  sources have no side-effect tools; outputs are validated (citations, links,
  terms, limits) before anything is saved.
- Tests run without a model key: `PLATFORM_AI_SCRIPTED=1` swaps in a
  deterministic scripted model (`lib/ai/models/scripted.ts`), refused in
  production builds, so e2e covers the whole pipeline.
