'use client'

import { Check, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { type FormEvent, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ProductProfileForm } from '@/components/workspace/WorkspaceProductProfile'
import { trackOnboarding } from '@/lib/onboarding/funnel'
import { ONBOARDING_POST_COUNT } from '@/lib/onboarding/plan-target'
import type { StoredProductProfile } from '@/lib/tenant/product-profile'
import { useTRPCClient } from '@/lib/trpc/react'
import { cn } from '@/lib/utils'
import { getAuthErrorMessage } from './error-message'
import { authInputClassName, FormAlert, SubmitButton } from './fields'

const POLL_MS = 2_000

/** The first campaign's stages, shown while they run; the first is the site read. */
const LAUNCH_STEPS = [
  'Reading your site',
  'Writing the brief',
  `Planning ${ONBOARDING_POST_COUNT} posts`,
  'Producing visuals and copy',
]
/** The campaign page to open when a stage stops: spec, plan, then assets. */
const STEP_PAGES = ['spec', 'spec', 'plan', 'assets']

type Stage =
  | { kind: 'url'; manual: boolean; problem: string | null }
  | { kind: 'reading'; startedAt: number }
  | { extracted: boolean; kind: 'review' }
  | { campaignId: string | null; error: string | null; kind: 'launching'; step: number }

type LaunchRun = { error: string | null; id: string; resultId: string | null; status: string }

function Heading({ children, lead }: { children: string; lead: string }) {
  return (
    <div>
      <h1 className="text-xl font-medium text-white">{children}</h1>
      <p className="mt-1.5 text-neutral-400">{lead}</p>
    </div>
  )
}

function Elapsed({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(startedAt)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [])
  return <>{Math.max(0, Math.round((now - startedAt) / 1_000))}s</>
}

/**
 * Onboarding's product step: paste the product's URL, review the profile
 * read from the site (or describe it by hand), and confirm. Confirming
 * creates the first campaign and runs spec, plan, and produce on it, then
 * opens its copy for approval.
 */
export function OnboardingProduct({
  campaignsEnabled,
  initialProfile,
}: {
  /** Without the campaign workflow, confirming saves the profile and opens the app. */
  campaignsEnabled: boolean
  initialProfile: StoredProductProfile | null
}) {
  const trpcClient = useTRPCClient()
  const [profile, setProfile] = useState(initialProfile)
  const [pages, setPages] = useState<string[]>([])
  const [url, setUrl] = useState(initialProfile?.url ?? '')
  const [sentence, setSentence] = useState('')
  const [formKey, setFormKey] = useState(0)
  const [stage, setStage] = useState<Stage>(
    initialProfile
      ? { extracted: true, kind: 'review' }
      : { kind: 'url', manual: false, problem: null }
  )

  async function readSite(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    trackOnboarding('onboarding_product_started', { path: 'url' })
    setStage({ kind: 'reading', startedAt: Date.now() })
    try {
      const result = await trpcClient.onboarding.readSite.mutate({
        sentence: sentence.trim() || undefined,
        url: url.trim(),
      })
      if (!result.ok) {
        setStage({
          kind: 'url',
          manual: true,
          problem: `We could not read that site: ${result.reason} Describe your product below instead.`,
        })
        return
      }
      setProfile(result.profile)
      setPages(result.pages)
      setFormKey((key) => key + 1)
      setStage({ extracted: result.extracted, kind: 'review' })
    } catch (error) {
      setStage({
        kind: 'url',
        manual: true,
        problem: `${getAuthErrorMessage(error, 'We could not read that site.')} Describe your product below instead.`,
      })
    }
  }

  async function waitFor({ run }: { run: LaunchRun }): Promise<LaunchRun> {
    let current = run
    while (current.status === 'RUNNING') {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS))
      current = (await trpcClient.launch.run.query({ runId: current.id })).run
    }
    if (current.status === 'FAILED') throw new Error(current.error ?? 'The step failed.')
    return current
  }

  async function launch(saved: StoredProductProfile): Promise<void> {
    setProfile(saved)
    trackOnboarding('onboarding_profile_confirmed', {
      extracted: stage.kind === 'review' && stage.extracted,
    })
    if (!campaignsEnabled) {
      window.location.assign('/')
      return
    }
    let campaignId: string | null = null
    let step = 1
    const advance = (next: number) => {
      step = next
      setStage({ campaignId, error: null, kind: 'launching', step })
    }
    advance(1)
    try {
      const started = await trpcClient.onboarding.startCampaign.mutate({ pages })
      campaignId = started.campaignId
      const spec = await waitFor(await trpcClient.launch.spec.generate.mutate({ campaignId }))
      // Approving is a reviewer's call; without the permission, the reviewers take it from here.
      if (!started.canApprove || !spec.resultId) {
        window.location.assign(`/campaigns/${campaignId}/spec`)
        return
      }
      await trpcClient.launch.spec.approve.mutate({ specId: spec.resultId })
      advance(2)
      const plan = await waitFor(
        await trpcClient.launch.plan.generate.mutate({
          campaignId,
          timelineItems: ONBOARDING_POST_COUNT,
        })
      )
      if (!plan.resultId) throw new Error('The plan was not saved.')
      await trpcClient.launch.plan.approve.mutate({ planId: plan.resultId })
      advance(3)
      await waitFor(await trpcClient.launch.produce.mutate({ campaignId }))
      trackOnboarding('onboarding_campaign_ready', { posts: ONBOARDING_POST_COUNT })
      window.location.assign(`/campaigns/${campaignId}/copy`)
    } catch (error) {
      setStage({
        campaignId,
        error: getAuthErrorMessage(error, 'A step failed.'),
        kind: 'launching',
        step,
      })
    }
  }

  if (stage.kind === 'launching') {
    return (
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-8 px-6 py-12">
        <Heading lead="This takes a few minutes. Keep this tab open.">
          {`Creating your first ${ONBOARDING_POST_COUNT} posts`}
        </Heading>
        <ol aria-live="polite" className="flex flex-col gap-4">
          {LAUNCH_STEPS.map((label, index) => {
            const done = index < stage.step
            const active = index === stage.step && !stage.error
            return (
              <li className="flex items-center gap-3 text-sm" key={label}>
                <span
                  aria-hidden
                  className={cn(
                    'grid size-6 place-items-center rounded-full',
                    done ? 'bg-white text-black' : 'border border-white/[0.12] text-neutral-500'
                  )}
                >
                  {done ? (
                    <Check className="size-3.5" strokeWidth={2.5} />
                  ) : active ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : null}
                </span>
                <span className={done || active ? 'text-white' : 'text-neutral-500'}>
                  {label}
                  <span className="sr-only">{done ? ' (done)' : active ? ' (working)' : ''}</span>
                </span>
              </li>
            )
          })}
        </ol>
        {stage.error ? (
          <div className="flex flex-col gap-3">
            <FormAlert>{stage.error}</FormAlert>
            {stage.campaignId ? (
              <Button asChild className="w-fit rounded-lg" variant="outline">
                <Link href={`/campaigns/${stage.campaignId}/${STEP_PAGES[stage.step]}`}>
                  Open the campaign
                </Link>
              </Button>
            ) : (
              <Button
                className="w-fit rounded-lg"
                onClick={() => setStage({ extracted: true, kind: 'review' })}
                variant="outline"
              >
                Back to your product
              </Button>
            )}
          </div>
        ) : null}
      </div>
    )
  }

  if (stage.kind === 'review') {
    return (
      <div className="flex flex-1 flex-col gap-8 px-6 py-10">
        <Heading
          lead={
            stage.extracted
              ? 'We read your site. Fix anything that is off; what you edit stays as you wrote it.'
              : 'We could only read your homepage’s title and description. Fill in the rest.'
          }
        >
          Does this look right?
        </Heading>
        <ProductProfileForm
          canManage
          initialUrl={url}
          key={formKey}
          onSaved={launch}
          profile={profile}
          submitLabel="Looks right"
        />
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col gap-8 px-6 py-10">
      <form className="mx-auto flex w-full max-w-md flex-col gap-6" onSubmit={readSite}>
        <Heading lead="Paste your product’s URL. Shots reads your site and drafts what it is, who it is for, and what it does.">
          Your product
        </Heading>
        <div className="space-y-2">
          <label className="text-sm font-medium text-neutral-300" htmlFor="product-site-url">
            Product URL
          </label>
          <Input
            className={authInputClassName}
            disabled={stage.kind === 'reading'}
            id="product-site-url"
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://acme.com"
            required
            type="url"
            value={url}
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium text-neutral-300" htmlFor="product-site-sentence">
            In one sentence, what does it do? <span className="text-neutral-500">(optional)</span>
          </label>
          <Input
            className={authInputClassName}
            disabled={stage.kind === 'reading'}
            id="product-site-sentence"
            maxLength={300}
            onChange={(event) => setSentence(event.target.value)}
            placeholder="Invoicing that runs itself for small agencies"
            value={sentence}
          />
        </div>
        {stage.kind === 'reading' ? (
          <p aria-live="polite" className="text-sm text-neutral-400" role="status">
            Reading your site… <Elapsed startedAt={stage.startedAt} />. This takes about 20 seconds.
          </p>
        ) : null}
        {stage.kind === 'url' && stage.problem ? <FormAlert>{stage.problem}</FormAlert> : null}
        <SubmitButton busy={stage.kind === 'reading'} busyLabel="Reading your site…">
          Read my site
        </SubmitButton>
        {stage.kind === 'url' && !stage.manual ? (
          <button
            className="w-fit text-sm text-neutral-400 underline underline-offset-4 hover:text-white"
            onClick={() => {
              trackOnboarding('onboarding_product_started', { path: 'manual' })
              setStage({ kind: 'url', manual: true, problem: null })
            }}
            type="button"
          >
            Describe it yourself instead
          </button>
        ) : null}
      </form>
      {stage.kind === 'url' && stage.manual ? (
        <section aria-labelledby="product-manual-heading" className="flex flex-col gap-4">
          <h2 className="text-base font-medium text-white" id="product-manual-heading">
            Describe your product
          </h2>
          <ProductProfileForm
            canManage
            initialUrl={url}
            key={`manual-${formKey}`}
            onSaved={launch}
            profile={profile}
            submitLabel="Looks right"
          />
        </section>
      ) : null}
    </div>
  )
}
