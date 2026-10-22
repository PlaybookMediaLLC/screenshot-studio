# RFC 035: Pricing and Unit Economics

**Status:** Implemented; revised for no free plan (see Implementation)  
**Status note (2026-10-16):** The Free plan was removed. Every workspace needs a paid plan to use the product.  
**Phase 0 update (2026-10-16):** Checkout returns to `/api/billing/checkout/return` and applies the plan immediately; `/pricing` shows why a visitor is there; onboarding has a plan step; workspace settings have a Billing section; credit packs require a subscription. No trial.  
**Packaging update (2026-10-17):** Seat and social channel limits are enforced; Billing settings show every monthly allowance and the pack balance; launch agents send a smaller design schema and skip visuals a re-run already finished.
**Date:** 2026-10-15  
**Revised:** 2026-10-16  
**Owners:** Product and Engineering  
**Depends on:** RFC 015, RFC 021, RFC 034, `lib/billing/plans.ts`, `services/internal/product/quota.go`

## Decision

Sell three paid plans, priced on the value of a launch and protected by a
cost-based meter, at a 75% gross margin when a workspace uses half its
allowance. There is no free plan.

| Plan       | Monthly     | Billed annually | Included each month                                                                    |
| ---------- | ----------- | --------------- | -------------------------------------------------------------------------------------- |
| Pro        | $199        | $169/mo         | 3,600 AI credits (about 8 launches), 120 posts, 5,000 emails                           |
| Business   | $699        | $594/mo         | 13,200 AI credits (about 30 launches), 480 posts, 25,000 emails                        |
| Enterprise | from $3,000 | annual only     | 54,000 AI credits (about 125 launches), 2,400 posts, 100,000 emails, SSO, SCIM, drains |

Every plan includes the editor, every image tool, release intake, and
approvals. An extra launch is $29 for 500 AI credits. Pack credits are spent
after the monthly allowance and do not expire. No trial is configured.

**One AI credit is $0.01 of model spend at list price.** Every AI action
consumes credits in proportion to what it costs. With prompt caching and the
visuals agent on Sonnet, a launch is about 430 credits.

### No free plan

Every customer pays. The editor and the tools are part of the paid product,
not a separate free tier, so there is one way in: choose a plan.

- A free tier serves people who never buy, and its cost (model spend,
  captures, storage, support) is paid by the customers who do.
- The editor and tools are worth paying for on their own. Giving them away
  sets their price at zero.
- One rule is easier to enforce than two. The product needs one gate, not a
  separate allowance table and abuse controls for unpaid use.

`free` remains an internal plan value: it is the state of a workspace without
a subscription. It has no features and every allowance is zero. A new
workspace starts in that state, and a workspace returns to it when its
subscription ends.

### Allowances

| Allowance               | Pro   | Business | Enterprise |
| ----------------------- | ----- | -------- | ---------- |
| AI credits per month    | 3,600 | 13,200   | 54,000     |
| Scheduled posts / month | 120   | 480      | 2,400      |
| Emails per month        | 5,000 | 25,000   | 100,000    |
| API writes per minute   | 300   | 1,500    | 10,000     |
| Concurrent jobs         | 5     | 25       | 250        |
| Storage                 | 25 GB | 250 GB   | 5 TB       |

A workspace without a subscription gets zero of each.

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
- There is no unpaid usage to subsidize. A workspace without a subscription
  cannot run AI actions, schedule posts, or send email, so blended margin is
  the paid-plan margin above. Its only cost is the data it keeps: at most
  $0.38 a month for a lapsed Pro workspace at its full 25 GB in R2.
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
8. **Sonnet for the long loops.** The production visuals agent and the
   editor copilot use the `drafting` role. Watch the visual critique pass
   rate and move visuals back to `deep` if it drops.
9. **Cancellation locks the workspace.** A workspace on `free` keeps its
   releases, assets, campaigns, and settings, but cannot use any of them
   until it subscribes again. Nothing is deleted when a subscription ends.
10. **The `workspace:use` gate.** Using the product at all requires the
    `workspace:use` feature, which every paid plan includes and `free` does
    not. It is enforced in these places:
    - **Go backend.** `services/internal/product/entitlements.go` sets its
      minimum plan to Pro; `services/internal/product/bootstrap.go` grants it
      only to an active workspace on a paid plan, which is what the web reads;
      `services/internal/product/quota.go` gives `free` zero of every
      allowance and refuses metering for an inactive workspace; storage
      limits in `services/internal/product/assets_media.go` give `free` 0
      bytes. A workspace with no entitlement record reads as `free`.
    - **Web proxy.** `lib/auth/sign-in-gate.ts` redirects the standalone
      editor tools and every image tool: no session goes to sign-in, no
      workspace to onboarding, no paid plan to `/pricing?subscribe=required`.
    - **Page guards.** The editor at `/`, assets, activity, and campaigns
      read `hasPaidPlan` from `lib/auth/page-access.ts` and redirect the
      same way.
    - **Editor utility APIs.** `/api/screenshot`, `/api/export`,
      `/api/tweet/{id}`, and `/api/image-proxy` call `requirePaidAccess`
      (`lib/api/require-account.ts`). They accept a session or a workspace
      API key with `artifact:read`, and return `401 unauthorized` without
      either and `403 workspace_feature_not_entitled` without a paid plan.
    - **Tenant API.** `requireTenantAccess` (`lib/tenant/access.ts`) checks
      `workspace:use` on every `/api/v1` operation, for sessions and API keys.
    - **Go writes.** Creating releases (API, form, and webhook ingestion) and
      source apps requires `release:create` and `source-app:create`, which
      only paid plans grant (`requireWorkspaceFeature` in
      `services/internal/product/entitlements.go`).
11. **Plan limits.** Seats and social channels are capped per plan in
    `services/internal/product/plan_limits.go`, mirrored in
    `lib/billing/plans.ts` (`test/ai-credit-metering.test.ts` fails if they
    drift). A refused add answers `403 plan_limit_reached` with the limit.
    - **Seats.** Members plus pending, unexpired invitations hold seats.
      Inviting checks both (`InviteMember` in `services/internal/product/invitations.go`);
      acceptance checks members only (`RespondInvitation` in
      `services/internal/product/invitation_response.go`). Better Auth delegates
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
    - **Products.** A workspace has one product profile (RFC 012), so the
      product limit is one per workspace on every plan.
    - Existing members and channels above a lower plan's limit are kept after
      a downgrade; only new ones are refused.

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

| Limit           | Pro | Business | Enterprise |
| --------------- | --- | -------- | ---------- |
| Seats           | 5   | 20       | unlimited  |
| Products        | 1   | 1        | 1          |
| Social channels | 3   | 15       | unlimited  |

Seats cost nothing to serve. They are a packaging line between a founder and a
team, not a cost line. The recommended product limits (Business 5, Enterprise
unlimited) need more than one product profile per workspace, which RFC 012
lists as a non-goal; until that changes, each product is its own workspace.

## Risks

- **X pricing** can change again. It already rose from $0.01 to $0.20 per link
  post in April 2026. Keep X posts countable separately.
- **Model prices** move. Credits are defined in list-price dollars, so a price
  change updates the credit cost of an action, not the plan.
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
approximate.
