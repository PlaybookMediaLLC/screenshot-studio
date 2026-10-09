'use client'

import { useRouter } from 'next/navigation'
import { useId, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { type CampaignPlanContent, campaignPlanSchema } from '@/lib/launch/spec-schema'
import { useTRPCClient } from '@/lib/trpc/react'

/** Advanced: edit the whole plan as JSON, checked against the schema before it is sent. */
export function PlanJsonEditor({
  campaignId,
  content,
  planId,
}: {
  campaignId: string
  content: CampaignPlanContent
  planId: string
}) {
  const trpcClient = useTRPCClient()
  const router = useRouter()
  const id = useId()
  const original = JSON.stringify(content, null, 2)
  const [text, setText] = useState(original)
  const [errors, setErrors] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [, startRefresh] = useTransition()

  async function save() {
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch (error) {
      setErrors([`That is not valid JSON. ${error instanceof Error ? error.message : ''}`.trim()])
      return
    }
    const result = campaignPlanSchema.safeParse(parsed)
    if (!result.success) {
      setErrors(
        result.error.issues
          .slice(0, 8)
          .map((issue) => `${issue.path.join('.') || 'plan'}: ${issue.message}`)
      )
      return
    }
    setErrors([])
    setSaving(true)
    try {
      const { plan } = await trpcClient.launch.plan.update.mutate({
        basePlanId: planId,
        campaignId,
        content: result.data,
        summary: 'Edited plan',
      })
      toast.success(`Saved as v${plan.version}`)
      startRefresh(() => router.refresh())
    } catch (error) {
      setErrors([error instanceof Error ? error.message : 'The plan could not be saved.'])
    } finally {
      setSaving(false)
    }
  }

  return (
    <details className="group rounded-2xl bg-white/[0.015] ring-1 ring-white/[0.08]">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 select-none [&::-webkit-details-marker]:hidden">
        <span className="text-sm font-medium text-white">Edit plan as JSON</span>
        <span className="text-xs text-neutral-500 group-open:hidden">Advanced</span>
      </summary>
      <div className="flex flex-col gap-3 border-t border-white/[0.07] p-5">
        <label className="text-sm font-medium text-white" htmlFor={id}>
          Plan JSON
        </label>
        <p className="text-xs leading-5 text-neutral-500" id={`${id}-help`}>
          Saving creates a new version. Angles must cite claims in the spec, and assets and timeline
          items must use the plan’s own angle and asset keys.
        </p>
        <textarea
          aria-describedby={`${id}-help`}
          aria-invalid={errors.length > 0 || undefined}
          className="h-[28rem] w-full resize-y rounded-lg bg-black/20 px-3 py-2 font-mono text-xs leading-5 text-neutral-200 ring-1 ring-white/[0.08] outline-none focus:ring-white/25 aria-invalid:ring-red-500/40"
          id={id}
          onChange={(event) => setText(event.target.value)}
          spellCheck={false}
          value={text}
        />
        {errors.length > 0 ? (
          <div className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300" role="alert">
            <ul className="list-disc space-y-0.5 pl-4">
              {errors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button
            className="rounded-lg"
            disabled={text === original || saving}
            onClick={() => {
              setText(original)
              setErrors([])
            }}
            size="sm"
            type="button"
            variant="ghost"
          >
            Reset
          </Button>
          <Button
            className="rounded-lg"
            disabled={text === original || saving}
            onClick={() => void save()}
            size="sm"
            type="button"
          >
            {saving ? 'Saving…' : 'Save plan'}
          </Button>
        </div>
      </div>
    </details>
  )
}
