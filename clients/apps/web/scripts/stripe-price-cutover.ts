import { fileURLToPath } from 'node:url'
import Stripe from 'stripe'
import { z } from 'zod'
import { annualMonthlyPrice, CREDIT_PACKS, PLAN_PRICES } from '@/lib/billing/plans'

/**
 * Moves Shots onto the prices in lib/billing/plans.ts, in the order
 * docs/rfcs/023-pricing-and-unit-economics.md ("Stripe cutover") requires.
 * Run from clients/apps/web with a live key that can write prices,
 * subscriptions and billing-portal configurations, and the five CURRENT
 * STRIPE_PRICE_* values:
 *
 *   npx tsx scripts/stripe-price-cutover.ts          # plan: prints, changes nothing
 *   npx tsx scripts/stripe-price-cutover.ts apply    # new prices, subscriptions moved
 *   npx tsx scripts/stripe-price-cutover.ts finish   # after the new IDs are deployed
 */

/** The variables that hold the five Stripe prices Shots sells. */
export const PRICE_KEYS = [
  'STRIPE_PRICE_PRO_MONTHLY',
  'STRIPE_PRICE_PRO_ANNUAL',
  'STRIPE_PRICE_BUSINESS_MONTHLY',
  'STRIPE_PRICE_BUSINESS_ANNUAL',
  'STRIPE_PRICE_EXTRA_LAUNCH',
] as const
type PriceKey = (typeof PRICE_KEYS)[number]

/** A US-dollar price in cents; a null interval is a one-time price. */
export type TargetPrice = { interval: 'month' | 'year' | null; unitAmount: number }

/** What each price should charge now, read from lib/billing/plans.ts. */
export function targetPrices(): Record<PriceKey, TargetPrice> {
  const pack = /^\$(\d+)$/.exec(CREDIT_PACKS.launch.price)
  if (!pack) throw new Error(`Cannot read the pack price "${CREDIT_PACKS.launch.price}".`)
  return {
    STRIPE_PRICE_PRO_MONTHLY: { interval: 'month', unitAmount: PLAN_PRICES.pro * 100 },
    STRIPE_PRICE_PRO_ANNUAL: { interval: 'year', unitAmount: annualMonthlyPrice('pro') * 1200 },
    STRIPE_PRICE_BUSINESS_MONTHLY: { interval: 'month', unitAmount: PLAN_PRICES.business * 100 },
    STRIPE_PRICE_BUSINESS_ANNUAL: {
      interval: 'year',
      unitAmount: annualMonthlyPrice('business') * 1200,
    },
    STRIPE_PRICE_EXTRA_LAUNCH: { interval: null, unitAmount: Number(pack[1]) * 100 },
  }
}

/** Statuses that still bill, so their subscriptions move to the new price. */
const LIVE_STATUSES: ReadonlySet<Stripe.Subscription.Status> = new Set([
  'active',
  'past_due',
  'trialing',
])

/** One subscription item to move from an old price to its replacement. */
export type SubscriptionMove = { from: string; item: string; subscription: string; to: string }

/** Every item of a live subscription that is on a replaced price. */
export function subscriptionMoves(
  subscriptions: readonly Pick<Stripe.Subscription, 'id' | 'items' | 'status'>[],
  replacements: Readonly<Record<string, string>>
): SubscriptionMove[] {
  return subscriptions.flatMap((subscription) =>
    LIVE_STATUSES.has(subscription.status)
      ? subscription.items.data.flatMap((item) => {
          const to = replacements[item.price.id]
          return to
            ? [{ from: item.price.id, item: item.id, subscription: subscription.id, to }]
            : []
        })
      : []
  )
}

function charges(price: Stripe.Price, target: TargetPrice): boolean {
  return (
    price.active &&
    price.currency === 'usd' &&
    price.unit_amount === target.unitAmount &&
    (price.recurring?.interval ?? null) === target.interval &&
    (price.recurring?.interval_count ?? 1) === 1
  )
}

const environmentSchema = z.object({
  STRIPE_SECRET_KEY: z.string().min(1),
  ...Object.fromEntries(PRICE_KEYS.map((key) => [key, z.string().startsWith('price_')])),
})

async function main(): Promise<void> {
  const mode = z.enum(['plan', 'apply', 'finish']).parse(process.argv[2] ?? 'plan')
  const env = environmentSchema.parse(process.env) as Record<PriceKey | 'STRIPE_SECRET_KEY', string>
  const stripe = new Stripe(env.STRIPE_SECRET_KEY)
  const targets = targetPrices()
  const replacements: Record<string, string> = {}
  const next: Record<string, string> = {}

  for (const key of PRICE_KEYS) {
    const old = await stripe.prices.retrieve(env[key])
    if (old.currency !== 'usd')
      throw new Error(`${key} is in ${old.currency}; this prices in US cents.`)
    const target = targets[key]
    const product = typeof old.product === 'string' ? old.product : old.product.id
    let price = charges(old, target)
      ? old
      : (await stripe.prices.list({ active: true, limit: 100, product })).data.find((candidate) =>
          charges(candidate, target)
        )
    if (!price && mode === 'apply') {
      price = await stripe.prices.create({
        currency: 'usd',
        metadata: { app: 'shots', variable: key },
        product,
        unit_amount: target.unitAmount,
        ...(old.nickname ? { nickname: old.nickname } : {}),
        ...(target.interval ? { recurring: { interval: target.interval } } : {}),
      })
    }
    const id = price?.id ?? `(new ${key})`
    console.log(
      `${key}: ${old.id} $${(old.unit_amount ?? 0) / 100} -> ${id} $${target.unitAmount / 100}`
    )
    next[key] = id
    if (id !== old.id) replacements[old.id] = id
  }

  const subscriptions: Stripe.Subscription[] = []
  for (const key of PRICE_KEYS.filter((key) => targets[key].interval)) {
    for await (const subscription of stripe.subscriptions.list({
      limit: 100,
      price: env[key],
      status: 'all',
    })) {
      subscriptions.push(subscription)
    }
  }
  const moves = subscriptionMoves(subscriptions, replacements)
  console.log(`${moves.length} live subscription item(s) on an old price.`)

  if (mode === 'finish') {
    // Archiving an old price before its replacement exists would leave nothing to sell.
    if (Object.values(next).some((id) => !id.startsWith('price_')))
      throw new Error('Some new prices do not exist yet. Run apply first.')
    if (moves.length > 0)
      throw new Error('Live subscriptions are still on old prices. Run apply first.')
    const { data } = await stripe.billingPortal.configurations.list({ active: true, limit: 100 })
    for (const configuration of data.filter((item) => item.metadata?.app === 'shots')) {
      await stripe.billingPortal.configurations.update(configuration.id, { active: false })
      console.log(`Deactivated billing portal configuration ${configuration.id}.`)
    }
    for (const old of Object.keys(replacements)) {
      await stripe.prices.update(old, { active: false })
      console.log(`Archived ${old}.`)
    }
    return
  }

  for (const move of moves) {
    console.log(`${move.subscription}: ${move.from} -> ${move.to}`)
    if (mode === 'apply') {
      // No proration: each customer pays the new, lower price from the next renewal.
      await stripe.subscriptions.update(
        move.subscription,
        { items: [{ id: move.item, price: move.to }], proration_behavior: 'none' },
        { idempotencyKey: `shots-price-cutover-${move.item}-${move.to}` }
      )
    }
  }
  console.log('\nPut these in Infisical (prod, /screenshot-studio), deploy, then run finish:')
  for (const key of PRICE_KEYS) console.log(`${key}=${next[key]}`)
  if (mode === 'plan')
    console.log('\nPlan only: nothing changed. Run with apply to make these changes.')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
