import {
  checkoutPlanSchema,
  CREDIT_PACKS,
  getWorkspaceQuota,
  hasWorkspaceFeature,
  workspacePlanSchema,
  workspaceQuotaSchema,
  type WorkspaceFeature,
  type WorkspacePlan,
  type WorkspaceQuota,
} from '@/lib/billing/plans'
import { cn } from '@/lib/utils'
import type { z } from 'zod'
import { Mark, RowTable } from './blocks'
import { CheckoutButton } from './CheckoutButton'
import { CtaLink } from './CtaLink'
import { Check, checkoutPathSchema, ctaToneSchema, MONO, MUTED } from './primitives'

const PLAN = workspacePlanSchema.enum
const QUOTA = workspaceQuotaSchema.enum

/**
 * The plans a customer can buy. `free` stays in the schema as the internal
 * "no subscription" state, so it is excluded from everything shown.
 */
const displayedPlanSchema = workspacePlanSchema.exclude([PLAN.free])
type DisplayedPlan = z.infer<typeof displayedPlanSchema>
const DISPLAYED_PLANS = displayedPlanSchema.options

/**
 * The price shown on each plan card. Derived in docs/rfcs/035: a 75% gross
 * margin at half of each plan's allowance, with annual billing 15% off.
 * Change a price here and every card and table updates.
 */
export const PLAN_PRICES: Record<DisplayedPlan, { price: string; note: string }> = {
  pro: { price: '$199', note: 'per month, or $169 billed annually' },
  business: { price: '$699', note: 'per month, or $594 billed annually' },
  enterprise: { price: 'From $3,000', note: 'per month, billed annually' },
}

const PLAN_COPY: Record<
  DisplayedPlan,
  { name: string; tagline: string; cta: { href: string; label: string } }
> = {
  pro: {
    name: 'Pro',
    tagline: 'For teams that ship every week',
    cta: { href: '/contact', label: 'Choose Pro' },
  },
  business: {
    name: 'Business',
    tagline: 'For teams with many products and channels',
    cta: { href: '/contact', label: 'Choose Business' },
  },
  enterprise: {
    name: 'Enterprise',
    tagline: 'For security reviews and scale',
    cta: { href: '/contact', label: 'Contact sales' },
  },
}

const QUOTA_LABELS: Record<WorkspaceQuota, string> = {
  'ai:credits:monthly': 'AI credits per month',
  'posts:monthly': 'Scheduled posts per month',
  'emails:monthly': 'Release emails per month',
  'api:write:minute': 'API writes per minute',
  'jobs:concurrent': 'Concurrent jobs',
  'storage:bytes': 'Asset storage',
}

const QUOTA_ORDER: WorkspaceQuota[] = [
  QUOTA['ai:credits:monthly'],
  QUOTA['posts:monthly'],
  QUOTA['emails:monthly'],
  QUOTA['api:write:minute'],
  QUOTA['jobs:concurrent'],
  QUOTA['storage:bytes'],
]

/** Plan features read from the entitlement code, so the cards cannot drift from enforcement. */
const CODE_FEATURES: { feature: WorkspaceFeature; label: string }[] = [
  { feature: 'release:create', label: 'Release intake: form, API, webhooks' },
  { feature: 'asset:create', label: 'Save visuals to the workspace' },
  { feature: 'asset:update', label: 'Edit and delete saved visuals' },
  { feature: 'enterprise:sso', label: 'SAML and OIDC single sign-on' },
  { feature: 'enterprise:scim', label: 'SCIM user provisioning' },
  { feature: 'enterprise:audit-drain', label: 'Signed audit log export to your SIEM' },
]

/** Capabilities every workspace has, whatever the plan. */
const EVERY_PLAN = [
  'Editor, image tools, and video export',
  'Six roles and approval on every post',
  'Append-only audit log, 90 days',
]

/** Enterprise terms from the retention docs rather than the entitlement table. */
const ENTERPRISE_TERMS = ['Longer audit retention', 'Legal hold']

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const

/** 268435456 → "256 MB". Binary units, as the quotas are defined. */
function formatBytes(bytes: number): string {
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${Number.isInteger(value) ? value : value.toFixed(1)} ${UNITS[unit]}`
}

/** A plan quota as it should read on the page. */
export function formatQuota(plan: WorkspacePlan, quota: WorkspaceQuota): string {
  const value = getWorkspaceQuota(plan, quota)
  return quota === QUOTA['storage:bytes'] ? formatBytes(value) : value.toLocaleString('en-US')
}

function featuresFor(plan: DisplayedPlan, previous: DisplayedPlan | null): string[] {
  const fromCode = CODE_FEATURES.filter(
    ({ feature }) =>
      hasWorkspaceFeature(plan, feature) &&
      (previous === null || !hasWorkspaceFeature(previous, feature))
  ).map(({ label }) => label)
  if (previous === null) return [...EVERY_PLAN, ...fromCode]
  if (plan === PLAN.enterprise) return [...fromCode, ...ENTERPRISE_TERMS]
  return fromCode.length > 0 ? fromCode : ['Higher limits on every quota']
}

/** Polar-style plan columns: price, limits, and what each plan adds. */
export function PlanCards({ location }: { location: string }) {
  const plans = DISPLAYED_PLANS
  return (
    <div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {plans.map((plan, index) => {
          const copy = PLAN_COPY[plan]
          const previous = index === 0 ? null : plans[index - 1]
          return (
            <div
              className={cn(
                'flex flex-col p-6',
                plan === PLAN.pro ? 'bg-[#181818] ring-1 ring-white/15' : 'bg-[#111]'
              )}
              key={plan}
            >
              <div className="flex items-center justify-between">
                <h3 className="text-2xl tracking-[-0.015em] text-white">{copy.name}</h3>
                {plan === PLAN.pro ? (
                  <span
                    className={cn(
                      MONO,
                      'rounded-full bg-white px-2 py-0.5 text-[10px] uppercase tracking-[0.06em] text-black'
                    )}
                  >
                    Popular
                  </span>
                ) : null}
              </div>
              <p className={cn('mt-1 min-h-[56px] text-[17px] leading-snug', MUTED)}>
                {copy.tagline}
              </p>
              <p className="mt-8 text-[30px] leading-none tracking-[-0.03em] text-white">
                {PLAN_PRICES[plan].price}
              </p>
              <p className={cn('mt-2 text-[15px]', MUTED)}>{PLAN_PRICES[plan].note}</p>
              {checkoutPlanSchema.safeParse(plan).success ? (
                <CheckoutButton
                  choices={[
                    { body: { interval: 'monthly', plan }, label: copy.cta.label },
                    { body: { interval: 'annual', plan }, label: 'or pay annually' },
                  ]}
                  className="mt-6"
                  location={`${location}_${plan}`}
                  path={checkoutPathSchema.enum['/api/billing/checkout']}
                />
              ) : (
                <CtaLink
                  className="mt-6 justify-center"
                  href={copy.cta.href}
                  label={copy.cta.label}
                  location={`${location}_${plan}`}
                  tone={ctaToneSchema.enum.secondary}
                />
              )}
              <dl className="mt-8 space-y-2.5 border-t border-[#212121] pt-6 text-[15px]">
                {QUOTA_ORDER.map((quota) => (
                  <div className="flex items-baseline justify-between gap-4" key={quota}>
                    <dt className={MUTED}>{QUOTA_LABELS[quota]}</dt>
                    <dd className={cn(MONO, 'text-[13px] text-white')}>
                      {formatQuota(plan, quota)}
                    </dd>
                  </div>
                ))}
              </dl>
              <div className="mt-6 flex-1 border-t border-[#212121] pt-6">
                {previous ? (
                  <p className={cn('mb-3 text-[13px]', MUTED)}>
                    Everything in {PLAN_COPY[previous].name}, plus
                  </p>
                ) : null}
                <ul className="space-y-3">
                  {featuresFor(plan, previous).map((feature) => (
                    <li className="flex items-start gap-3 text-[15px] text-white/85" key={feature}>
                      <Check className="mt-0.5" />
                      {feature}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )
        })}
      </div>
      <div className="mt-4 flex flex-col gap-6 bg-[#111] p-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-xl tracking-[-0.015em] text-white">
            Extra launch{' '}
            <span className={cn(MONO, 'ml-2 text-[13px] text-white/70')}>
              {CREDIT_PACKS.launch.price}
            </span>
          </h3>
          <p className={cn('mt-1 max-w-[560px] text-[15px] leading-[1.6]', MUTED)}>
            {CREDIT_PACKS.launch.credits.toLocaleString('en-US')} AI credits, about one launch, on
            any plan. They are spent after the monthly allowance and do not expire.
          </p>
        </div>
        <CheckoutButton
          choices={[{ body: { pack: 'launch' }, label: 'Buy an extra launch' }]}
          className="sm:w-[240px]"
          location={`${location}_extra_launch`}
          path={checkoutPathSchema.enum['/api/billing/credits']}
        />
      </div>
      <p className={cn('mt-6 max-w-[760px] text-[15px] leading-[1.6]', MUTED)}>
        Launch intelligence is in early access for design partners on any plan. One credit is one
        cent of AI cost. A launch uses about 430 credits ($4.30). At zero, Shots stops before the
        next AI call.
      </p>
    </div>
  )
}

/** Every limit and feature side by side, read from the entitlement code. */
export function PlanComparison() {
  const plans = DISPLAYED_PLANS
  return (
    <RowTable
      caption="Plan comparison"
      head={['', ...plans.map((plan) => PLAN_COPY[plan].name)]}
      rows={[
        ...QUOTA_ORDER.map((quota) => ({
          label: QUOTA_LABELS[quota],
          cells: plans.map((plan) => (
            <span className={cn(MONO, 'text-[13px] text-white')} key={plan}>
              {formatQuota(plan, quota)}
            </span>
          )),
        })),
        ...EVERY_PLAN.map((label) => ({
          label,
          cells: plans.map((plan) => <Mark key={plan} value={true} />),
        })),
        ...CODE_FEATURES.map(({ feature, label }) => ({
          label,
          cells: plans.map((plan) => (
            <Mark key={plan} value={hasWorkspaceFeature(plan, feature)} />
          )),
        })),
        ...ENTERPRISE_TERMS.map((label) => ({
          label,
          cells: plans.map((plan) => <Mark key={plan} value={plan === PLAN.enterprise} />),
        })),
        {
          label: 'Launch intelligence',
          cells: plans.map((plan) => <Mark key={plan} value="Design partners" />),
        },
      ]}
    />
  )
}
