# RFC 023: Pricing and Unit Economics

**Priority:** 023 — Reusable foundations
**Previous ID:** 035 ([renumbering map](renumbering-2026-10-24.md))
> **Roadmap disposition (2026-10-23):** Maintain existing paid plans and metering. RFC 001 validates pilot packaging and service costs; it does not change entitlements.
> See the [current execution order](README.md). Older decision text is
> historical wherever it conflicts with that order or the audited architecture.

**Status:** Implemented; there is no free plan (2026-10-29)
**Historical status (2026-10-16):** The Free plan was removed. The 2026-10-24 limited scheduling amendment below reopened it; the product owner withdrew it on 2026-10-29.
**Phase 0 update (2026-10-16):** Checkout returns to `/api/billing/checkout/return` and applies the plan immediately; `/pricing` shows why a visitor is there; onboarding has a plan step; workspace settings have a Billing section; credit packs require a subscription. No trial.  
**Packaging update (2026-10-17):** Seat and social channel limits are enforced; Billing settings show every monthly allowance and the pack balance; launch agents send a smaller design schema and skip visuals a re-run already finished.
**Repricing (2026-10-29):** Paid plans are repriced against Typefully, Postiz and Post Bridge: Pro $39, Business $99, Enterprise from $999, 10 seats on Pro and unlimited seats above it, and more channels and posts. Later the same day every text role moved to Claude Haiku 5.5, which cut a launch from about 430 credits to about 20, and prices dropped again to Pro $29, Business $79 and Enterprise from $799. See [Competitor benchmark](#competitor-benchmark-2026-10-29), [AI on Claude Haiku 5.5](#ai-on-claude-haiku-55-2026-10-29) and [Stripe cutover](#stripe-cutover-for-the-2026-10-29-prices).
**Date:** 2026-10-15  
**Revised:** 2026-10-29
**Owners:** Product and Engineering  
**Historical dependencies:** RFC 047, RFC 048, RFC 014, `lib/billing/plans.ts`, `server/internal/product/quota.go`

## Decision

Sell three paid plans at social-scheduler prices, protected by a cost-based
meter, at a 50% gross margin when a workspace uses 30% of its allowance, where
customers usually sit. There is no free plan.

| Plan       | Monthly   | Billed annually | Included each month                                                                                  |
| ---------- | --------- | --------------- | ---------------------------------------------------------------------------------------------------- |
| Pro        | $29       | $25/mo          | 10 seats, 15 channels, 600 AI credits (about 30 launches), 250 posts, 5,000 emails           |
| Business   | $79       | $67/mo          | Unlimited seats, 100 channels, 3,000 AI credits (about 150 launches), 600 posts, 25,000 emails         |
| Enterprise | from $799 | annual only     | Unlimited seats and channels, 15,000 AI credits (about 750 launches), 5,000 posts, 100,000 emails, SSO, SCIM, drains |

Each plan includes more than the plan above it did before 2026-10-29, for less.
Pro at $29 has twice the seats, five times the channels, twice the posts and
storage of the old $199 Pro, and about 30 launches a month where the old Pro
had about 8. Enterprise from $799 beats the old $699 Business on every
allowance. Business at $79 beats the old $199 Pro on every allowance but the
AI credit count (3,000 against 3,600), and a credit now buys about 20 times
more launch: about 150 launches against 8.

Every paid plan includes the image editor, every image tool, release intake,
approvals and the audit log. An extra launch is $12 for 500 AI credits, about
25 launches. Pack
credits are spent after the monthly allowance and do not expire. No trial is
configured.

**One AI credit is $0.01 of model spend at list price.** Every AI action
consumes credits in proportion to what it costs. On Claude Haiku 5.5 a launch is
about 20 credits (`LAUNCH_CREDITS` in `lib/billing/plans.ts`); on Opus and
Sonnet it was about 430.

### No free plan (2026-10-29)

The product owner withdrew the limited free scheduling tier on 2026-10-29.
`free` is again only the state of a workspace without a subscription: it keeps
its owner's seat, its data and nothing else. It has no features (`workspace:use`
and `content:drafts` need Pro), no allowance, and no social channel. Onboarding
ends by choosing Pro, Business or Enterprise, and a cancelled subscription
returns the workspace to this state with its data kept. Workspaces that used
free scheduling before the change keep their drafts and scheduled posts but
must subscribe to write or schedule again.

### Limited free scheduling (approved 2026-10-24, withdrawn 2026-10-29)

Historical. The product owner explicitly approved a free tier while implementing TF-002:
**one seat, one connected social account, ten scheduled posts per UTC month,
no AI, with advanced queue features remaining paid**. This amendment supersedes
the previous paid-only decision for this narrow workflow. Paid prices and their
allowances remain unchanged.

`free` now grants `workspace:use` and `content:drafts`: writing, previewing,
planning, and explicit-time or immediate scheduling of text/link posts. It
allows 60 API writes/minute; media storage, AI, email and concurrent agent-job
allowances remain zero. Media uploads and the screenshot/design tools remain
paid. Credit packs require a paid subscription, and previously purchased credits
cannot fund AI on a downgraded free workspace.

`workspace:paid` protects paid product surfaces. `content:scheduling-advanced`
protects next-slot selection, best-time recommendations, posting schedules,
natural posting times and follow-up automation. Go checks those options again
at commitment time, including defaults inherited before a downgrade. Seat and
channel admission remains serialized with billing changes; an over-limit
workspace must remove extra members/accounts or upgrade before free scheduling.
Usage is preserved across upgrades and downgrades, and replaying a committed
schedule never consumes another post.

New workspaces can choose **Continue with free scheduling** during onboarding.
Cancelled subscriptions retain data and return to this limited tier; inactive,
expired, suspended or unknown entitlement records still fail closed.

### Allowances

| Allowance               | Pro   | Business | Enterprise |
| ----------------------- | ----- | -------- | ---------- |
| AI credits per month    | 600   | 3,000    | 15,000     |
| Scheduled posts / month | 250   | 600      | 5,000      |
| Emails per month        | 5,000 | 25,000   | 100,000    |
| API writes per minute   | 300   | 1,500    | 10,000     |
| Concurrent jobs         | 5     | 25       | 250        |
| Storage                 | 50 GB | 250 GB   | 5 TB       |

A workspace without a subscription has every allowance in this table at zero.

## What the customer is buying

The platform does a job that today takes a stack of tools and a person:

| Job                         | Stack it replaces                | Small team (3 users) | Growing team (10)      |
| --------------------------- | -------------------------------- | -------------------- | ---------------------- |
| Release notes and changelog | LaunchNotes, Beamer, AnnounceKit | $99–$249             | $249–$799              |
| Launch copy                 | Jasper, Typefully, Taplio        | $20–$207             | custom–$1,000          |
| Screenshots and mockups     | Shots.so, Pika                   | $15–$30              | $100                   |
| Scheduling and approvals    | Buffer Team, Hootsuite   | $36–$297             | $120–$1,990            |
| **Total stack**             |                                  | **≈ $350/mo**        | **≈ $1,200–$3,900/mo** |

The stack still needs someone to write the brief, design the visuals, and
check the claims. A launch kit (cited spec, plan, eight visuals, posts for six
channels, approvals, scheduling) is several hours of product marketing and
design work. Pro's 30 launches cost about $1 each.

Until 2026-10-29 prices were set well above schedulers. That made Shots five
to ten times the price of the schedulers buyers compare it with, for fewer
channels and posts. Prices are now set at scheduler level (below), and the AI,
editor, release and approval work comes on top.

### Competitor benchmark (2026-10-29)

Read from each vendor's own pricing page on 2026-10-29 (Typefully's page
renders client-side and was read in a browser).

| Product     | Plan     | Monthly                      | Annual (per month) | Accounts                     | Posts / month | Seats             | AI and API                                                       |
| ----------- | -------- | ---------------------------- | ------------------ | ---------------------------- | ------------- | ----------------- | ---------------------------------------------------------------- |
| Typefully   | Free     | $0                           | $0                 | 1 social set                 | 10            | 1                 | API, MCP                                                         |
| Typefully   | Creator  | annual only                  | $99/yr (≈ $8)      | 1 social set                 | 1,000         | 1                 | AI writing, X analytics                                          |
| Typefully   | Business | per social set               | $18 per social set | up to 50 social sets         | 1,500         | unlimited         | higher AI usage and API rate limits, teams, roles                |
| Postiz      | Standard | $29                          | $23                | 5 channels                   | unlimited     | none              | AI copilot, 3 AI videos, API, CLI, MCP                           |
| Postiz      | Team     | $39                          | $31                | 10 channels                  | unlimited     | unlimited         | 100 AI images, 10 AI videos                                      |
| Postiz      | Pro      | $49                          | $39                | 30 channels                  | unlimited     | unlimited         | 300 AI images, 30 AI videos                                      |
| Postiz      | Ultimate | $99                          | $79                | 100 channels                 | unlimited     | unlimited         | 500 AI images, 60 AI videos                                      |
| Post Bridge | Marketer | $39                          | 2 months free      | 15 accounts                  | unlimited     | not listed        | API, MCP; no AI                                                  |
| Post Bridge | Operator | $99                          | 2 months free      | 99, then $1 per account      | unlimited     | team members      | API, MCP; no AI                                                  |

Postiz and Post Bridge offer a 7-day trial; Typefully has a free plan.
Schedulers price on accounts, include unlimited or near-unlimited posts and
seats, and include little or no AI. Shots undercuts Post Bridge's prices
($29 and $79 against $39 and $99), matches its channel counts (15, and 100 against 99), gives Pro 10
seats where Post Bridge's $39 plan lists none and Business unlimited seats, and includes what none of them do: AI launch kits, the
screenshot and video editor, release intake and emails, approvals on every
post and an append-only audit log.

Posts are where Shots still gives less: 250 and 600 a month against
unlimited. Shots pays X's per-post fee through its own X app (`X_API_KEY`), and
an X post with a link costs $0.20 (see [Everything else](#everything-else)), so
unlimited posts need X posts metered on their own. That is the next lever; see
[Risks](#risks).

## Cost model

### AI, per action

Measured from the code: model role per stage (`lib/ai/models/catalog.ts`),
step budgets (`lib/launch/budget.ts`, `maxSteps`), source budgets
(`lib/launch/sources.ts`: 8 sources × 8,000 characters), and the visuals
agent's re-sent context (about 18,000 characters of tool schemas plus the
spec, plan, and brand kit, measured from the tool definitions).

Anthropic list prices: Opus 5.5 $4 / $20 per million input / output tokens,
Sonnet 5.5 $2 / $10, Haiku 4.5 $1 / $5; cache reads $0.20; cache writes 1.25×
input. OpenRouter adds 5.5% on credit purchases and nothing on tokens.

| Action                                        | Model  | Today (uncached) | With prompt caching | Credits |
| --------------------------------------------- | ------ | ---------------- | ------------------- | ------- |
| Spec draft (~2 steps, ~20K-token prompt)      | Opus   | $0.40            | $0.35               | 35      |
| Plan draft (~2 steps)                         | Opus   | $0.24            | $0.22               | 22      |
| Produce: 8 visuals, ~50 steps, critique, copy | Sonnet | $13.69 (on Opus) | $1.90               | 190     |
| Revision proposal                             | Opus   | $0.12            | $0.12               | 12      |
| Editor AI request (4 steps)                   | Sonnet | $0.11            | $0.08               | 8       |
| Campaign studio copilot (~20 steps)           | Opus   | $2.80            | $0.90               | 90      |

A launch is a spec, a plan, a production, and three revisions: **$14.68
uncached on Opus, $2.83 cached with Sonnet visuals**. Allowing for
regenerations (×1.5), a launch is about **$4.30, or 430 credits**. A
worst-case production at the 96-step cap costs $43 uncached on Opus and about
$3.70 cached on Sonnet.

The visuals agent is the cost. It runs for up to `visuals × 7 + 12` steps and
re-sends its whole history every step, so it runs on Sonnet with prompt
caching: each step reads the history from cache instead of paying full input
price for it.

### Everything else

| Cost                            | Unit price                               | Source                                                                     |
| ------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------- |
| X post containing a link        | $0.20 (plain post $0.015)                | X API pay-per-use, docs.x.com                                              |
| LinkedIn, Instagram posting     | free                                     | LinkedIn Community Management API, Meta Graph API                          |
| Temporal workflow per post      | ≈ $0.001 (20 actions at $50 per million) | Temporal Cloud Developer plan, no minimum                                  |
| Release email                   | $0.90 per 1,000                          | Resend Pro overage                                                         |
| Asset storage                   | $0.015 per GB-month, no egress           | Cloudflare R2                                                              |
| Renders and captures per launch | ≈ $0.03                                  | Cloudflare Browser Rendering $0.09 per browser-hour; Microlink $49 for 46K |
| Payment processing              | 3.6% + $0.30 per charge                  | Stripe cards 2.9% + $0.30, Billing 0.7%                                    |

X is the one channel with a material per-post cost. The model assumes 40% of
scheduled posts go to X with a link.

### Fixed platform costs (estimate)

| Service                                                              | Monthly         |
| -------------------------------------------------------------------- | --------------- |
| DigitalOcean App Platform (2 web replicas, 1 backend; dedicated CPU) | ≈ $156          |
| PlanetScale Postgres (PS-10 HA)                                      | $39             |
| Upstash Redis                                                        | ≈ $20           |
| Temporal Cloud (Developer)                                           | ≈ $10           |
| Resend Pro                                                           | $20             |
| Microlink Pro                                                        | $49             |
| Cloudflare Workers Paid                                              | $5              |
| PostHog, Infisical                                                   | free tiers      |
| **Total**                                                            | **≈ $300–$350** |

Allocated at $3 per Pro, $5 per Business, and $50 per Enterprise workspace,
which covers the platform at about 100 paying workspaces and becomes margin
after that. Scheduler-level prices need that volume; at the earlier $10 and
$15 allocations they covered it at about 35. Instance sizes are an estimate; the deployment doc names the
components but not every size.

## Margin

Variable cost scales with how much of the allowance a workspace uses. Fixed
allocation, support, and payment processing do not.

| Plan       | Price | COGS at 30% use | GM at 30% | GM at 50% | GM at 100% | Annual GM at 30% |
| ---------- | ----- | --------------- | --------- | --------- | ---------- | ---------------- |
| Pro        | $29   | $16             | **45.2%** | 23.2%     | −31.6%     | 37.0%            |
| Business   | $79   | $45             | **42.9%** | 16.0%     | −51.4%     | 33.3%            |
| Enterprise | $799  | $429            | **46.4%** | 28.1%     | −17.6%     | (annual is list) |

Support is costed at $2, $5, and $150 a month. Enterprise is invoiced, so
payment processing is about 1.2%.

- This table charges AI at 30% of its credits like every other allowance.
  A credit now buys about 20 times more launch, so typical AI use is nearer
  10% of credits; at that, with the rest at 30%, the monthly plans clear about
  50% (Pro 49.6%, Business 50.9%, Enterprise 50.3%).
- Annual plans (15% off) land at 33–37% at 30% use, about 40–43% at typical AI use.
- A workspace that uses every allowance in full costs more than Pro or
  Business charges. The posts allowance drives it: at the assumed 40% share of
  X link posts, 250 posts cost up to $20 and 600 cost up to $49. Watch the
  X share per workspace; metering X posts separately removes this loss.
- The 2026-10-15 prices cleared 75% at half use and 62% at full use. The
  repricing trades that margin for prices buyers accept next to schedulers.
- Retained data for a lapsed Pro workspace can cost up to $0.75/month at its
  full 50 GB in R2, outside these paid-plan margins.
- An extra launch at $12 costs at most $5.92: 500 credits of model spend plus
  card fees (2.9% + $0.30). That is a 51% margin, about 25 launches on Claude Haiku 5.5. Its posts and emails come
  from the plan's own allowances.

Because the meter charges credits for what an action actually costs, margin no
longer depends on the action mix. A Pro workspace cannot spend more than its
600 credits ($6 of model cost) however it uses them, on any model.

### AI on Claude Haiku 5.5 (2026-10-29)

Every text role (`deep`, `drafting`, `fast`, `nano`) runs on Claude Haiku 5.5
through OpenRouter, in the web (`lib/ai/models/catalog.ts`) and in the Go
release automation and onboarding (`server/internal/platformai/platformai.go`),
which share one role catalog; transcription stays on Gemini
2.5 Flash, which takes audio. Haiku 5.5 is $0.10 / $0.50 per million tokens up
to 100K prompt tokens and $0.50 / $2.50 above, against Sonnet 5.5's $2 / $10
and Opus 5.5's $4 / $20: twenty times cheaper than Sonnet and forty times
cheaper than Opus at the same token counts.

Scaling the action table above by those ratios, a launch is about 12 credits
before regenerations and about 20 with them: the visuals agent about 10, the
spec, plan and revisions about 2. This is an estimate, not a measurement. The
meter records each call's real cost; replace `LAUNCH_CREDITS` with the
measured median once launches have run. Qwen 3.7 Flash was considered; above
32K prompt tokens, where the visuals agent runs, it costs about the same as
Haiku 5.5, and its only provider (Alibaba Cloud) could not be confirmed to pass
the no-training routing.

Haiku 5.5 thinks by default (adaptive, effort `medium`), rejects non-default
sampling parameters and assistant prefill, and accepts forced tool choice. No
call site sets sampling parameters. Quality on the launch pipeline is
unmeasured: compare its visuals and copy with the Opus and Sonnet output on
real launches before relying on it. `PLATFORM_AI_MODEL_DEEP` and
`PLATFORM_AI_MODEL_DRAFTING` move a role back to Opus or Sonnet without a
deploy; credits stay dollar-denominated, so margin holds on any model and only
the number of launches a plan covers changes.

## Implementation

1. **Prompt caching.** Every Anthropic model is created with OpenRouter's
   automatic cache control (`lib/ai/models/provider.ts`), so each agent step
   reads its growing history from cache. Usage accounting is on for every
   model, so each response carries its cost.
2. **Cost-based metering.** The model registry wraps every model in a meter
   middleware (`lib/ai/models/middleware/meter.ts`). An AI action runs inside
   `withAiCredits` (`lib/ai/metering`): it refuses to start with no credits
   left, admits each model call while credits remain, charges each call its
   reported cost (or its tokens at list price, `lib/ai/metering/pricing.ts`)
   in whole credits, and rounds the remainder up when the action ends. A model
   call outside a metered action is refused. The call that crosses the limit
   is recorded, so overrun is at most one call per running action.
3. **The meter.** The Go backend counts `ai:credits:monthly`,
   `posts:monthly`, and `emails:monthly` per UTC calendar month in Redis with
   [ulule/limiter](https://github.com/ulule/limiter)
   (`server/internal/quota/monthly.go`), whose Lua script increments and
   sets expiry atomically across web and worker processes. An amount of 0
   reads the balance. The meter fails closed. Web images from before the
   credit meter still send the old generation quota name; the backend counts
   it as AI credits.
4. **Allowances** are in `lib/billing/plans.ts` and
   `server/internal/product/quota.go` (`planQuotas`; storage is `storageLimits`
   in `assets_media.go`); `test/ai-credit-metering.test.ts` fails if they drift apart.
   **Prices** are `PLAN_PRICES` and `CREDIT_PACKS` in `lib/billing/plans.ts`;
   annual billing is derived from `ANNUAL_DISCOUNT`. The plan cards, pricing
   and Enterprise FAQs, landing FAQ, comparison and guide pages, `/llms.txt`
   and the JSON-LD offer all read them. `test/workspace-plans.test.ts` fails
   when the hand-written `public/llm.txt` stops quoting them. To change a
   price, edit those constants, update `public/llm.txt`, and follow the
   [Stripe cutover](#stripe-cutover-for-the-2026-10-29-prices) steps.
5. **Posts and emails.** Scheduling a post charges `posts:monthly` and
   sending a release announcement charges `emails:monthly` per recipient,
   both before the work and refunded if it does not commit.
6. **Checkout.** `POST /api/billing/checkout` opens Stripe Checkout for a
   workspace without a subscription, or the billing portal for one that
   already subscribes (`lib/billing/stripe.ts`). Checkout returns to
   `/api/billing/checkout/return`, which reads the session from Stripe,
   applies the plan, and opens onboarding's product step or the app. When
   Stripe has not activated the subscription yet, it opens
   `/pricing?checkout=pending`, which polls until the plan is applied.
   `POST /api/webhooks/stripe` verifies the Stripe signature, reads the
   subscription fresh from Stripe, and applies it through the same versioned
   entitlement sync as the signed billing webhook, retrying a stale version
   with the one the backend reports. When a workspace has more than one
   subscription, the live one decides, then the larger plan, then the newest,
   so an old subscription ending never downgrades a paying workspace.
   Subscription states map in `lib/billing/stripe-events.ts`: `active` and
   `trialing` keep the plan; `past_due` keeps it until a grace date 14 days
   after the current period started (`PAST_DUE_GRACE_DAYS`); `canceled`,
   `unpaid`, `paused`, and `incomplete_expired` return the workspace to
   `free`. The portal cancels at period end.
7. **Extra launches.** `POST /api/billing/credits` opens a one-time Checkout
   for a 500-credit pack. When the session is paid, the webhook grants the
   credits through the backend (`workspace_credit_grant`, once per Checkout
   session). AI credit usage draws on the monthly allowance first, then on
   purchased packs, oldest first. Only a workspace on a paid plan can buy a
   pack; the route answers `403 workspace_feature_not_entitled` otherwise.
8. **One small model for every text role.** Since 2026-10-29 every text
   role runs on Claude Haiku 5.5 (see above). Watch the visual critique pass
   rate and move `drafting` or `deep` back to Sonnet or Opus if it drops.
9. **Cancellation retains data.** Releases, assets and campaigns remain stored;
   every operation requires resubscription. Nothing is deleted.
10. **Workspace gates.** `workspace:use` and `content:drafts` admit active paid
    workspaces; `workspace:paid` protects paid pages, tools, credit packs,
    AI and release APIs. Operation-specific features remain enforced in the
    tenant REST/MCP contracts and Go services. `content:scheduling-advanced`
    is checked before scheduling and editing queue defaults. The backend is
    authoritative; changing client controls cannot grant access. Unknown or
    inactive plans fail closed. A missing entitlement row is a new free workspace.
11. **Plan limits.** Seats and social channels are capped per plan in
    `server/internal/product/plan_limits.go`, mirrored in
    `lib/billing/plans.ts` (`test/ai-credit-metering.test.ts` fails if they
    drift). A refused add answers `403 plan_limit_reached` with the limit.
    - **Seats.** Members plus pending, unexpired invitations hold seats.
      Inviting checks both (`InviteMember` in `server/internal/product/invitations.go`);
      acceptance checks members only (`RespondInvitation` in
      `server/internal/product/invitation_response.go`). Better Auth delegates
      these operations to the same Go transactions, holding the workspace capacity
      lock through commitment. Other direct membership additions retain the
      `beforeAddMember` preflight through `GET /v1/internal/workspaces/{id}/seat`;
      mixed invitation/provisioning concurrency still requires verification. A workspace without
      a subscription has its owner's seat and no other.
    - **Social channels.** Active channel connections count. Finishing a
      social OAuth or creating a connection checks the limit; reconnecting an
      account the workspace already holds does not count again. The check
      runs after the OAuth exchange, so a refused connection can leave an
      unused integration in the social API, as a disconnect does today.
    - **Products.** A workspace has one product profile (RFC 017), so the
      product limit is one per workspace on every plan.
    - Existing members and channels above a lower plan's limit are kept after
      a downgrade. New ones are refused.

Stripe setup. The products live in the Playbook Media organization's account
(`acct_1OXB7hJ5a5YKQUvY`), in live mode. These are the 2026-10-15 prices; the
2026-10-29 prices replace them through the [Stripe cutover](#stripe-cutover-for-the-2026-10-29-prices):

| Variable                        | Price                            | Stripe price ID                  |
| ------------------------------- | -------------------------------- | -------------------------------- |
| `STRIPE_PRICE_PRO_MONTHLY`      | Shots Pro, $199/month            | `price_1UR2aVJ5a5YKQUvYsctgLQXR` |
| `STRIPE_PRICE_PRO_ANNUAL`       | Shots Pro, $2,028/year           | `price_1UR2beJ5a5YKQUvYJkDsVEFc` |
| `STRIPE_PRICE_BUSINESS_MONTHLY` | Shots Business, $699/month       | `price_1UR2d6J5a5YKQUvYwYskMeEF` |
| `STRIPE_PRICE_BUSINESS_ANNUAL`  | Shots Business, $7,128/year      | `price_1UR2etJ5a5YKQUvY6ugXO7JW` |
| `STRIPE_PRICE_EXTRA_LAUNCH`     | Shots Extra Launch, $29 one-time | `price_1UR2g3J5a5YKQUvYA4LRZ18D` |

The price IDs are in Infisical (`prod`, `/screenshot-studio`). Each web deploy
(`infra/digitalocean/update-web-image.py`) adds every `STRIPE_*` key that
Infisical holds to the web service, so they need no manual App Platform edit.

- **Webhook:** destination "Shots - Production" (`we_1UR39aJ5a5YKQUvYb4EiNff4`)
  sends `customer.subscription.{created,updated,deleted,paused,resumed}`,
  `checkout.session.completed`, and `checkout.session.async_payment_succeeded`
  to `https://shots.playbookmedia.io/api/webhooks/stripe`, as API version
  `2026-09-30.endive` (the version stripe-node pins). Events for the
  account's other products are ignored: their prices are not Shots prices.
- **Billing portal:** the app creates its own portal configuration on first
  use, tagged `metadata.app = shots`, listing only the Shots plans. The
  account's default portal is left alone because other products share it.
- **Secrets:** `STRIPE_WEBHOOK_SECRET` is the destination's signing secret.
  `STRIPE_SECRET_KEY` should be a restricted key with Checkout Sessions
  write, Customer portal write, Subscriptions read, and Prices read.

Until both secrets are set, the Upgrade and Buy buttons send people to the
contact page.

### Stripe cutover for the 2026-10-29 prices

Stripe prices cannot change amount, and `lib/billing/stripe.ts` maps a
subscription to its plan by price ID. Switching the price variables while a
subscription is still on an old price would leave that subscription without
a plan. `scripts/stripe-price-cutover.ts` (in `clients/apps/web`) does the
Stripe side in order. Run it with the five current `STRIPE_PRICE_*` values
and a live key that can write prices, subscriptions and billing-portal
configurations (the app's restricted key cannot). Its amounts come from
`PLAN_PRICES`, `ANNUAL_DISCOUNT` and `CREDIT_PACKS`:

1. `npx tsx scripts/stripe-price-cutover.ts` prints the plan and changes
   nothing: Pro $29/month and $300/year, Business $79/month and $804/year,
   Extra Launch $12, and every live subscription that will move.
2. `... apply` creates those prices on the existing products (reusing any
   that already match, so a re-run creates nothing twice) and moves every
   active, trialing or past-due subscription on an old price to its new
   price without proration. Each customer pays the lower price from the next
   renewal. Until the IDs change, the webhook for a moved subscription names
   a price the app does not sell yet, so it changes nothing and the
   workspace keeps its plan. It prints the new `STRIPE_PRICE_*` values.
3. Put those values in Infisical (`prod`, `/screenshot-studio`) and deploy.
4. `... finish`, still with the old values, refuses while any live
   subscription is on an old price, deactivates the billing-portal
   configuration tagged `metadata.app = shots` so the app rebuilds it with
   the new prices, and archives the old prices.

A subscription cancelled between steps 2 and 3 is ignored the same way, so
its workspace keeps its plan until a later event for it; keep the gap short.

The new allowances apply to every workspace on a plan at deploy, including
invoiced Enterprise workspaces. A workspace that used more than Pro's 600 AI
credits a month now fits Business, which costs less than its old Pro bill
and includes more of everything.

## Open items

All seven are resolved:

1. **Paywall notice on `/pricing`.** Done: `PricingNotice` explains
   `subscribe=required`, Checkout outcomes, and credit purchases.
2. **Checkout success lands in the app.** Done: see Implementation 6.
3. **Choose a plan during onboarding.** Done: `/onboarding/plan`.
4. **In-app Billing settings.** Done: workspace settings show the plan and
   its standing, AI credits, scheduled posts, and emails left against each
   allowance, the extra launch credit balance, and the portal link.
5. **Block credit packs without a subscription.** Done: see Implementation 7.
6. **Trial decision.** No trial. Revisit with conversion data (see Risks).
7. **Seat, product, and channel limits.** Done: see Implementation 11.

## Cost reductions

- **Smaller tool schemas.** PR #137 grew `editDesign`'s schema from about
  11,900 to 32,270 characters. Launch visuals render to PNG, so the visuals
  agent and design revisions get `stillDesignChangesSchema`
  (`lib/design/document.ts`), which drops the motion-only sections
  (animation, timeline, slides): 22,936 characters, 29% less, re-sent on
  every step. `test/design-document.test.ts` fails if it grows past 24,000.
  The editor copilot and campaign studio keep the full schema.
- **Skip regeneration of unchanged assets.** The render key now hashes each
  referenced image by content rather than by asset id
  (`lib/design/render-key.ts`, version 2), so a recapture that stores the
  same bytes under a new id still reuses the cached render. A production
  re-run skips plan assets that already have a rendered design for the same
  plan version, not sent back by review and newer than the brand kit
  (`unproducedAssets` in `lib/launch/budget.ts`); it sizes its budget to what
  is left and skips the visuals agent when nothing is. Editing the plan makes
  a new version, which remakes every asset.

## Packaging beyond credits

Enforced since 2026-10-17 (Implementation 11):

| Limit           | Pro       | Business  | Enterprise |
| --------------- | --------- | --------- | ---------- |
| Seats           | 10        | unlimited | unlimited  |
| Products        | 1         | 1         | 1          |
| Social channels | 15        | 100       | unlimited  |

Seats cost nothing to serve, and Typefully Business, Postiz Team and Post
Bridge Operator do not cap them, so Business and Enterprise do not either
(2026-10-29). Pro keeps 10 seats as the line between a small team and a
larger one, which also keeps the last-seat invitation lock exercised. Before
that, Pro had 5 seats and 3 channels and Business 20 seats and 15 channels. The recommended product limits (Business 5, Enterprise
unlimited) need more than one product profile per workspace, which RFC 017
lists as a non-goal; until that changes, each product is its own workspace.

## Risks

- **X pricing** can change again. It already rose from $0.01 to $0.20 per link
  post in April 2026, and at scheduler prices it is the cost that turns full
  use into a loss. Meter X posts separately; posts to the other channels
  could then be unlimited, as at Postiz and Post Bridge.
- **Model prices** move. Credits are defined in list-price dollars, so a price
  change updates the credit cost of an action, not the plan.
- **Claude Haiku 5.5 quality** on launches is untested. If its visuals or
  copy fall short, a role moves back to Sonnet or Opus through its
  `PLATFORM_AI_MODEL_*` override; margin holds, but a plan then covers about
  a twentieth as many launches, so `LAUNCH_CREDITS` and the copy that quotes
  it must change with it.
- **No free plan** removes the try-before-buy path. Watch pricing-page
  conversion and sign-ups that never subscribe, and revisit the no-trial
  decision with that data.
- **Utilization assumptions** are estimates. Measure credit use per workspace
  in the first quarter and revisit allowances.
- **Fixed-cost sizes** are estimates from the deployment doc and should be
  checked against the DigitalOcean and PlanetScale invoices.

## Sources

Vendor pages fetched on 2026-10-15: developers.cloudflare.com/r2/pricing,
developers.cloudflare.com/browser-rendering/pricing, temporal.io/pricing,
resend.com/pricing, docs.digitalocean.com/products/app-platform/details/pricing,
planetscale.com/pricing, upstash.com/pricing/redis, microlink.io/pricing,
posthog.com/docs/product-analytics/pricing, openrouter.ai/pricing,
docs.x.com/x-api/getting-started/pricing, stripe.com/pricing,
stripe.com/billing/pricing, infisical.com/pricing. Competitor plans from their
public pricing pages and the third-party sources noted in the research, with
Publer, Typefully, Hootsuite monthly prices, and Shots.so treated as
approximate. Competitor benchmark, fetched on 2026-10-29: typefully.com/pricing
(rendered in a browser), postiz.com/pricing, docs.postiz.com/cloud/plans,
post-bridge.com/pricing, post-bridge.com/llms-full.txt. Model prices from
openrouter.ai/api/v1/models, fetched on 2026-10-29.
