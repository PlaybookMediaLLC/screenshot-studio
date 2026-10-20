'use client'

import { useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { CheckoutButton } from '@/components/platform-landing/CheckoutButton'
import { CtaLink } from '@/components/platform-landing/CtaLink'
import { checkoutPathSchema } from '@/components/platform-landing/primitives'
import { Group, Pill, type PillTone, Row, Section } from '@/components/platform-ui'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { checkoutPlanSchema } from '@/lib/billing/plans'
import { useTRPCClient } from '@/lib/trpc/react'
import { getErrorMessage } from './settings-client'

type Summary = Awaited<ReturnType<ReturnType<typeof useTRPCClient>['billing']['summary']['query']>>

/** What a return trip from a credit-pack Checkout tells the admin, keyed by `credits`. */
const OUTCOMES: Record<string, string> = {
  cancelled: 'The credit purchase was cancelled. You have not been charged.',
  success: 'Payment received. Your extra launch credits are on the way.',
}

const STATUS: Record<string, { label: string; tone: PillTone }> = {
  active: { label: 'Active', tone: 'green' },
  cancelled: { label: 'Cancelled', tone: 'gray' },
  past_due: { label: 'Past due', tone: 'yellow' },
  suspended: { label: 'Suspended', tone: 'red' },
  trialing: { label: 'Trial', tone: 'blue' },
}

const PLAN_NAMES: Record<string, string> = {
  business: 'Business',
  enterprise: 'Enterprise',
  free: 'No plan',
  pro: 'Pro',
}

/** What is left of one monthly allowance, out of what the plan includes. */
function UsageRow({
  allowance,
  description,
  label,
}: {
  allowance: Summary['credits']
  description: string
  label: string
}) {
  return (
    <Row description={description} label={label} layout="inline">
      <span className="text-sm font-medium text-foreground tabular-nums">
        {allowance.left.toLocaleString('en-US')}
        <span className="text-muted-foreground">
          {' '}
          / {allowance.included.toLocaleString('en-US')}
        </span>
      </span>
    </Row>
  )
}

/**
 * The workspace's plan, its standing, what is left of each monthly allowance,
 * and its extra launch credits.
 * Owners and admins manage the subscription in Stripe's billing portal, pick
 * a plan when there is none, and buy an extra launch on a paid plan.
 */
export function WorkspaceBilling({ canManage }: { canManage: boolean }) {
  const trpcClient = useTRPCClient()
  const outcome = useSearchParams().get('credits')
  const [summary, setSummary] = useState<Summary | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    trpcClient.billing.summary
      .query()
      .then(setSummary)
      .catch((requestError: unknown) => setError(getErrorMessage(requestError)))
  }, [trpcClient])

  const status = summary
    ? (STATUS[summary.status] ?? { label: summary.status, tone: 'gray' })
    : null
  const checkoutPlan = checkoutPlanSchema.catch(checkoutPlanSchema.enum.pro).parse(summary?.plan)

  return (
    <Section
      description="What this workspace pays for and what is left of it this month."
      title="Plan and credits"
    >
      {outcome && OUTCOMES[outcome] ? (
        <Alert className="mb-4">
          <AlertDescription>{OUTCOMES[outcome]}</AlertDescription>
        </Alert>
      ) : null}
      <Group>
        {summary === null ? (
          <Row>
            <p className="text-sm text-muted-foreground">{error ?? 'Loading billing…'}</p>
          </Row>
        ) : (
          <>
            <Row
              description={
                summary.status === 'past_due'
                  ? `The last payment failed. Update your card to keep your plan${
                      summary.graceUntil
                        ? ` after ${new Date(summary.graceUntil).toLocaleDateString()}`
                        : ''
                    }.`
                  : summary.paid
                    ? 'In the billing portal: switch between Pro and Business or monthly and annual, update the card, download invoices, or cancel. Enterprise is arranged with sales.'
                    : 'Choose a plan to start using Shots: Pro or Business by card, or Enterprise through sales.'
              }
              label="Plan"
              layout="inline"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-foreground">
                  {PLAN_NAMES[summary.plan] ?? summary.plan}
                </span>
                {summary.paid && status ? <Pill tone={status.tone}>{status.label}</Pill> : null}
              </div>
            </Row>
            {summary.paid &&
            summary.cycle &&
            (summary.cycle.cancelsAt ?? summary.cycle.renewsAt) ? (
              <Row
                description={
                  summary.cycle.cancelsAt
                    ? 'Cancelled: the plan ends then. The workspace keeps its drafts, campaigns and assets, but its features and monthly allowances stop until someone chooses a plan. Renew in the billing portal before then to keep it.'
                    : `Billed ${summary.cycle.interval === 'annual' ? 'yearly' : 'monthly'}. Cancelling in the billing portal ends the plan at the end of the period, not at once.`
                }
                label={summary.cycle.cancelsAt ? 'Ends' : 'Renews'}
                layout="inline"
              >
                <span className="text-sm font-medium text-foreground tabular-nums">
                  {new Date(
                    summary.cycle.cancelsAt ?? summary.cycle.renewsAt ?? ''
                  ).toLocaleDateString(undefined, { dateStyle: 'medium' })}
                </span>
              </Row>
            ) : null}
            {summary.paid ? (
              <>
                <UsageRow
                  allowance={summary.credits}
                  description="AI credits left this month. One credit is one cent of AI cost."
                  label="AI credits"
                />
                <Row
                  description="Extra launch credits are spent after the monthly allowance and do not expire."
                  label="Extra launch credits"
                  layout="inline"
                >
                  <span className="text-sm font-medium text-foreground tabular-nums">
                    {summary.creditBalance.toLocaleString('en-US')}
                  </span>
                </Row>
                <UsageRow
                  allowance={summary.posts}
                  description="Scheduled posts left this month."
                  label="Scheduled posts"
                />
                <UsageRow
                  allowance={summary.emails}
                  description="Release emails left this month, counted per recipient."
                  label="Emails"
                />
              </>
            ) : null}
            {canManage ? (
              <Row layout="inline">
                <div className="flex flex-wrap items-start gap-3">
                  {summary.paid ? (
                    <>
                      <CheckoutButton
                        choices={[
                          {
                            body: { interval: 'monthly', plan: checkoutPlan },
                            label: 'Manage subscription',
                          },
                        ]}
                        className="w-[240px]"
                        location="workspace_billing_manage"
                        path={checkoutPathSchema.enum['/api/billing/checkout']}
                      />
                      <CheckoutButton
                        choices={[{ body: { pack: 'launch' }, label: 'Buy an extra launch' }]}
                        className="w-[240px]"
                        location="workspace_billing_extra_launch"
                        path={checkoutPathSchema.enum['/api/billing/credits']}
                      />
                    </>
                  ) : (
                    <CtaLink
                      href="/pricing"
                      label="Choose a plan"
                      location="workspace_billing_choose"
                    />
                  )}
                </div>
              </Row>
            ) : (
              <Row>
                <p className="text-sm text-muted-foreground">
                  Only workspace owners and admins can change the plan.
                </p>
              </Row>
            )}
          </>
        )}
      </Group>
    </Section>
  )
}
