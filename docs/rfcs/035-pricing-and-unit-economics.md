# RFC 035: Pricing and Unit Economics

**Status:** Accepted; implemented (see Implementation)  
**Date:** 2026-10-15  
**Owners:** Product and Engineering  
**Depends on:** RFC 015, RFC 021, RFC 034, `lib/billing/plans.ts`, `services/internal/product/quota.go`

## Decision

Sell four plans, priced on the value of a launch and protected by a cost-based
meter, at a 75% gross margin when a workspace uses half its allowance.

| Plan       | Monthly     | Billed annually | Included each month                                                                    |
| ---------- | ----------- | --------------- | -------------------------------------------------------------------------------------- |
| Free       | $0          | $0              | Editor and tools, release intake, approvals, 250 AI credits                            |
| Pro        | $199        | $169/mo         | 3,600 AI credits (about 8 launches), 120 posts, 5,000 emails                           |
| Business   | $699        | $594/mo         | 13,200 AI credits (about 30 launches), 480 posts, 25,000 emails                        |
| Enterprise | from $3,000 | annual only     | 54,000 AI credits (about 125 launches), 2,400 posts, 100,000 emails, SSO, SCIM, drains |

An extra launch is $29 for 500 AI credits, on any plan. Pack credits are
spent after the monthly allowance and do not expire. A one-time free trial
launch for Free workspaces is proposed but not built.

**One AI credit is $0.01 of model spend at list price.** Every AI action
consumes credits in proportion to what it costs. With prompt caching and the
visuals agent on Sonnet, a launch is about 430 credits.

## What the customer is buying

The platform does a job that today takes a stack of tools and a person:

| Job                         | Stack it replaces                | Small team (3 users) | Growing team (10)      |
| --------------------------- | -------------------------------- | -------------------- | ---------------------- |
| Release notes and changelog | LaunchNotes, Beamer, AnnounceKit | $99–$249             | $249–$799              |
| Launch copy                 | Jasper, Typefully, Taplio        | $20–$207             | custom–$1,000          |
| Screenshots and mockups     | Shots.so, Pika                   | $15–$30              | $100                   |
| Scheduling and approvals    | Buffer Team, Postiz, Hootsuite   | $36–$297             | $120–$1,990            |
| **Total stack**             |                                  | **≈ $350/mo**        | **≈ $1,200–$3,900/mo** |

The stack still needs someone to write the brief, design the visuals, and
check the claims. A launch kit (cited spec, plan, eight visuals, posts for six
channels, approvals, scheduling) is several hours of product marketing and
design work. Pro's eight launches cost about $25 each.

Prices are set below the stack they replace and well above schedulers, because
the platform does the work rather than storing it.

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

Allocated at $10 per Pro, $15 per Business, and $50 per Enterprise workspace,
which covers the platform at about 35 paying workspaces and becomes margin
after that. Instance sizes are an estimate; the deployment doc names the
components but not every size.

## Margin

Variable cost scales with how much of the allowance a workspace uses. Fixed
allocation, support, and payment processing do not.

| Plan       | Price  | COGS at 30% use | GM at 30% | GM at 50% | GM at 100% | Annual GM at 50% |
| ---------- | ------ | --------------- | --------- | --------- | ---------- | ---------------- |
| Pro        | $199   | $38             | 80.8%     | **75.5%** | 62.2%      | 71.9%            |
| Business   | $699   | $122            | 82.5%     | **76.7%** | 62.0%      | 73.2%            |
| Enterprise | $3,000 | $516            | 82.8%     | **76.6%** | 61.0%      | (annual is list) |

Support is costed at $5, $20, and $150 a month. Enterprise is invoiced, so
payment processing is about 1.2%.

- Monthly plans clear 75% at half use and stay above 60% at full use.
- Annual plans (15% off) land at 72–73% at half use and about 80% at 30% use,
  which is where annual customers usually sit.
- Free costs at most $3.96 a month per active workspace. The one-time trial
  launch costs $6.92 once, as acquisition spend.
- An extra launch at $29 costs at most $6.14: 500 credits of model spend plus
  card fees (2.9% + $0.30). That is a 79% margin. Its posts and emails come
  from the plan's own allowances.

Because the meter charges credits for what an action actually costs, margin no
longer depends on the action mix. A Pro workspace cannot spend more than its
3,600 credits ($38 of model cost) however it uses them.

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
   (`services/internal/quota/monthly.go`), whose Lua script increments and
   sets expiry atomically across web and worker processes. An amount of 0
   reads the balance. The meter fails closed. Web images from before the
   credit meter still send the old generation quota name; the backend counts
   it as AI credits.
4. **Allowances** are in `lib/billing/plans.ts` and
   `services/internal/product/quota.go`; `test/ai-credit-metering.test.ts`
   fails if they drift apart.
5. **Posts and emails.** Scheduling a post charges `posts:monthly` and
   sending a release announcement charges `emails:monthly` per recipient,
   both before the work and refunded if it does not commit.
6. **Checkout.** `POST /api/billing/checkout` opens Stripe Checkout for a
   free workspace, or the billing portal for one that already subscribes.
   `POST /api/webhooks/stripe` verifies the Stripe signature, reads the
   subscription fresh from Stripe, and applies it through the same versioned
   entitlement sync as the signed billing webhook, retrying a stale version
   with the one the backend reports. When a workspace has more than one
   subscription, the live one decides, then the larger plan, then the newest,
   so an old subscription ending never downgrades a paying workspace. A
   past-due workspace keeps its plan for 14 days; an ended subscription
   returns the workspace to Free.
7. **Extra launches.** `POST /api/billing/credits` opens a one-time Checkout
   for a 500-credit pack. When the session is paid, the webhook grants the
   credits through the backend (`workspace_credit_grant`, once per Checkout
   session). AI credit usage draws on the monthly allowance first, then on
   purchased packs, oldest first.
8. **Sonnet for the long loops.** The production visuals agent and the
   editor copilot use the `drafting` role. Watch the visual critique pass
   rate and move visuals back to `deep` if it drops.

Stripe setup. The products live in the Playbook Media organization's account
(`acct_1OXB7hJ5a5YKQUvY`), in live mode:

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

## Optional cost reductions

- **Shrink the tool schemas.** `editDesign` alone is about 11,900 characters
  re-sent every step. Cached reads make this cheap, but the first write and
  every miss pay full price.
- **Skip regeneration of unchanged assets** using the content-addressed render
  cache from RFC 010.

## Packaging beyond credits

Recommended limits that are not enforced in code today:

| Limit           | Free | Pro | Business | Enterprise |
| --------------- | ---- | --- | -------- | ---------- |
| Seats           | 2    | 5   | 20       | unlimited  |
| Products        | 1    | 1   | 5        | unlimited  |
| Social channels | –    | 3   | 15       | unlimited  |

Seats cost nothing to serve. They are a packaging line between a founder and a
team, not a cost line.

## Risks

- **X pricing** can change again. It already rose from $0.01 to $0.20 per link
  post in April 2026. Keep X posts countable separately.
- **Model prices** move. Credits are defined in list-price dollars, so a price
  change updates the credit cost of an action, not the plan.
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
approximate.
