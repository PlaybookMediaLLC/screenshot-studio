'use client'

import type { AutomationNode, AutomationOverview } from '@/lib/api/contracts/release-automation'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { actionAvailability, WORKFLOW_CLASSIFY } from '@/lib/workflows/actions'

/** The default AI relevance check a new node starts with. */
export const DEFAULT_CLASSIFY = {
  criteria:
    'Customer-visible features, improvements, or fixes a user would notice. Not refactors, dependency bumps, tests, or CI.',
  threshold: 0.7,
  creditLimit: 5,
}

/** Criteria, confidence bar, and budget for an AI relevance check node. */
export function ClassifyEditor({
  node,
  overview,
  onChange,
}: {
  node: AutomationNode
  overview: AutomationOverview
  onChange: (classify: NonNullable<AutomationNode['classify']>) => void
}) {
  const classify = node.classify ?? DEFAULT_CLASSIFY
  const availability = actionAvailability(overview, 'classify')
  return (
    <div className="space-y-3">
      <p className="text-xs leading-5 text-muted-foreground">{WORKFLOW_CLASSIFY.description}</p>
      {availability.available ? null : (
        <p
          role="note"
          className="rounded-lg bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300"
        >
          Not executable yet: {availability.reason}
        </p>
      )}
      <Label className="grid gap-1 text-sm">
        Worth marketing when
        <Textarea
          maxLength={1000}
          rows={4}
          value={classify.criteria}
          onChange={(event) => onChange({ ...classify, criteria: event.target.value })}
        />
      </Label>
      <Label className="grid gap-1 text-sm">
        Confidence threshold
        <Input
          type="number"
          min={0.5}
          max={0.99}
          step={0.05}
          value={classify.threshold}
          onChange={(event) => onChange({ ...classify, threshold: Number(event.target.value) })}
        />
      </Label>
      <Label className="grid gap-1 text-sm">
        AI credit limit
        <Input
          type="number"
          min={1}
          max={50}
          value={classify.creditLimit}
          onChange={(event) =>
            onChange({ ...classify, creditLimit: Math.trunc(Number(event.target.value)) || 0 })
          }
        />
      </Label>
      <p className="text-xs leading-5 text-muted-foreground">
        True runs the next steps; false takes the other branch. If the AI is unavailable or the
        workspace lacks credits, the run stops and asks for attention instead of guessing.
      </p>
      <dl className="grid gap-1 rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
        <div>
          <dt className="inline font-medium">Needs: </dt>
          <dd className="inline">
            {[WORKFLOW_CLASSIFY.entitlement, ...WORKFLOW_CLASSIFY.integrations].join(' · ')}
          </dd>
        </div>
        <div>
          <dt className="inline font-medium">Retries: </dt>
          <dd className="inline">{WORKFLOW_CLASSIFY.retry}</dd>
        </div>
      </dl>
    </div>
  )
}
