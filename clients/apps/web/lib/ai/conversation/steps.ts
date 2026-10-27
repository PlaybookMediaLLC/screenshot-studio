import type { BackendLaunchRunStep } from 'screenshot-studio-backend-sdk'
import { z } from 'zod'
import type { ToolErrorCode } from '@/lib/ai/tools/executor'

/**
 * How a conversation run's steps read in the UI (RFC 028, "Failed and
 * retryable steps"): the tool in plain words, a human-readable reason for a
 * failure, and what the person can do about it. A transient failure offers a
 * retry of that one step; a permanent one offers the corrective action. Pure,
 * so it is testable and shared by the router and the retry check.
 */

/** What a person can do about a failed step. */
export const stepActionSchema = z.enum([
  /** Re-run only this step with its recorded input. */
  'retry',
  /** Add the product profile first. */
  'onboarding',
  /** A role with more permissions has to do it. */
  'ask_admin',
  /** Send another message; nothing to retry in place. */
  'new_turn',
])
/** What a person can do about a failed step. */
export type StepAction = z.infer<typeof stepActionSchema>

/** A tool's own permanent failure may name its fix; see {@link describeStep}. */
export const stepFixSchema = z.enum(['onboarding'])
/** A tool's own permanent failure may name its fix. */
export type StepFix = z.infer<typeof stepFixSchema>

const TOOL_LABELS: Record<string, string> = {
  askClarification: 'Ask which page you meant',
  captureProductSurface: 'Take a fresh screenshot',
  createCampaign: 'Create the campaign',
  generateCampaign: 'Draft the spec, plan, and posts',
  getBrand: 'Read your brand',
  getProduct: 'Read your product',
  listProductSurfaces: 'Find the product pages',
  requestApproval: 'Submit posts for review',
}

/** Tools a retry may re-run; asking a question again is not a retry. */
const RETRYABLE_TOOLS = new Set(
  Object.keys(TOOL_LABELS).filter((name) => name !== 'askClarification')
)

/** Codes whose cause may pass, so the same input can succeed later. */
const TRANSIENT: ReadonlySet<ToolErrorCode> = new Set<ToolErrorCode>(['FAILED', 'TIMEOUT'])

const REASONS: Record<ToolErrorCode, string> = {
  CALL_LIMIT: 'This turn already did this as often as it may.',
  CANCELLED: 'The turn was cancelled before this finished.',
  DENIED: 'Your role cannot do this.',
  FAILED: 'Something went wrong on our side.',
  LOOP_DETECTED: 'The agent repeated this step and stopped.',
  REJECTED: 'This step could not finish.',
  TIMEOUT: 'This took too long.',
}

/** The step fields the description reads. */
export type DescribableStep = Pick<
  BackendLaunchRunStep,
  'errorCode' | 'id' | 'index' | 'outputSummary' | 'status' | 'toolName'
>

/** A step as the conversation panel shows it. */
export type StepView = {
  action: StepAction | null
  id: string
  index: number
  label: string
  reason: string | null
  status: BackendLaunchRunStep['status']
}

/** The tool's own failure message and fix, when the step recorded its output. */
function ownFailure(output: unknown): { error: string | null; fix: StepFix | null } {
  const value = (output ?? {}) as { error?: unknown; fix?: unknown }
  return {
    error: typeof value.error === 'string' && value.error.trim() ? value.error.trim() : null,
    fix: stepFixSchema.safeParse(value.fix).data ?? null,
  }
}

/** The executor's code; the trace stores it lowercase. */
const errorCodeOf = (step: DescribableStep): ToolErrorCode =>
  (step.errorCode?.toUpperCase() as ToolErrorCode | undefined) ??
  (step.status === 'DENIED' ? 'DENIED' : 'REJECTED')

/** Whether a later step re-ran this one's tool and succeeded. */
export function isRecovered(step: DescribableStep, steps: readonly DescribableStep[]): boolean {
  return steps.some(
    (other) =>
      other.index > step.index && other.toolName === step.toolName && other.status === 'SUCCEEDED'
  )
}

/** Whether a step failed for a reason a retry can fix, and was not recovered yet. */
export function isRetryableStep(
  step: DescribableStep,
  steps: readonly DescribableStep[] = []
): boolean {
  return (
    step.status === 'FAILED' &&
    Boolean(step.toolName && RETRYABLE_TOOLS.has(step.toolName)) &&
    TRANSIENT.has(errorCodeOf(step)) &&
    !isRecovered(step, steps)
  )
}

/** What the panel shows for one step of a run whose steps are `steps`. */
export function describeStep(step: DescribableStep, steps: readonly DescribableStep[]): StepView {
  const label = (step.toolName && TOOL_LABELS[step.toolName]) || 'Think it through'
  const base = { id: step.id, index: step.index, label, status: step.status }
  if (step.status === 'SUCCEEDED') return { ...base, action: null, reason: null }
  const code = errorCodeOf(step)
  const own = ownFailure(step.outputSummary)
  // A tool's own failure (REJECTED) is written for people; the executor's are not.
  const reason = (code === 'REJECTED' && own.error) || REASONS[code] || REASONS.REJECTED
  const recovered = isRecovered(step, steps)
  const action: StepAction | null = recovered
    ? null
    : isRetryableStep(step, steps)
      ? 'retry'
      : own.fix === 'onboarding'
        ? 'onboarding'
        : code === 'DENIED'
          ? 'ask_admin'
          : 'new_turn'
  return { ...base, action, reason }
}
