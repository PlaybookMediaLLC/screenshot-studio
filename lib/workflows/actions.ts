import { z } from 'zod'
import {
  automationActionTypeSchema,
  type AutomationActionType,
  type AutomationGraph,
  type AutomationOverview,
} from '@/lib/api/contracts/release-automation'

/** What an action reads and records; the Go validator checks the same names. */
export const workflowOutputSchema = z.enum(['releaseId', 'campaignId', 'reviewIds'])

/**
 * Static facts about one executor action. Whether it can run right now
 * (worker, plan, model provider) comes from the backend overview, never from
 * this table.
 */
export const workflowActionSpecSchema = z.strictObject({
  type: automationActionTypeSchema,
  label: z.string(),
  description: z.string(),
  /** The output this action consumes, from an earlier action on every path. */
  input: workflowOutputSchema.nullable(),
  output: workflowOutputSchema,
  /** The lowest workflow language version that can contain this action. */
  minSchemaVersion: z.number().int().positive(),
  /** Who may configure or activate it; execution uses a scoped service principal. */
  permission: z.string(),
  integrations: z.array(z.string()),
  entitlement: z.string(),
  retry: z.string(),
  /** Whether it spends AI credits; such actions carry an explicit budget. */
  paid: z.boolean(),
  /** Whether a person must approve its result before anything is published. */
  humanApproval: z.boolean(),
})

/** One registered action's static metadata. */
export type WorkflowActionSpec = z.infer<typeof workflowActionSpecSchema>

const ADMIN = 'Workspace owner or admin session'

/** The executor's action catalogue, keyed so every registered type is covered. */
export const WORKFLOW_ACTIONS = {
  create_release: {
    type: 'create_release',
    label: 'Create release',
    description: 'Records a source-linked release from the verified GitHub event.',
    input: null,
    output: 'releaseId',
    minSchemaVersion: 1,
    permission: ADMIN,
    integrations: ['GitHub repository'],
    entitlement: 'release:create',
    retry: 'Up to 4 attempts, 2 minutes each. Idempotent per run and node.',
    paid: false,
    humanApproval: false,
  },
  create_campaign: {
    type: 'create_campaign',
    label: 'Create campaign drafts',
    description:
      'Creates a campaign with one draft post per destination from the release text, brand, and audience.',
    input: 'releaseId',
    output: 'campaignId',
    minSchemaVersion: 1,
    permission: ADMIN,
    integrations: ['Published brand kit', 'Connected destination'],
    entitlement: 'campaign:workflow',
    retry: 'Up to 4 attempts, 2 minutes each. Idempotent per run and node.',
    paid: false,
    humanApproval: false,
  },
  generate_copy: {
    type: 'generate_copy',
    label: 'Generate channel copy',
    description:
      'Rewrites each draft post for its channel in your brand voice with AI. Release text is treated as evidence, never as instructions.',
    input: 'campaignId',
    output: 'campaignId',
    minSchemaVersion: 2,
    permission: ADMIN,
    integrations: ['AI model provider on the worker', 'AI credits'],
    entitlement: 'campaign:workflow',
    retry:
      'Up to 3 attempts, 5 minutes each. The model is called and credits are charged at most once per run.',
    paid: true,
    humanApproval: false,
  },
  submit_review: {
    type: 'submit_review',
    label: 'Submit for human review',
    description:
      'Sends the drafts to the review queue and notifies approvers. A person approves before anything publishes.',
    input: 'campaignId',
    output: 'reviewIds',
    minSchemaVersion: 1,
    permission: ADMIN,
    integrations: [],
    entitlement: 'release:create',
    retry: 'Up to 4 attempts, 2 minutes each. Review transitions are idempotent.',
    paid: false,
    humanApproval: true,
  },
} as const satisfies Record<AutomationActionType, WorkflowActionSpec>

/** Registered actions in palette order. */
export const workflowActionTypes = automationActionTypeSchema.options

/** Actions whose recorded output another action can consume. */
export function producersOf(type: AutomationActionType): AutomationActionType[] {
  const input = WORKFLOW_ACTIONS[type].input
  return workflowActionTypes.filter((candidate) => WORKFLOW_ACTIONS[candidate].output === input)
}

/** The backend's verdict for an action, defaulting to unavailable when unreported. */
export function actionAvailability(overview: AutomationOverview, type: AutomationActionType) {
  const reported = overview.actions?.find((action) => action.type === type)
  if (reported) return reported
  return {
    type,
    available: overview.executorAvailable && WORKFLOW_ACTIONS[type].minSchemaVersion === 1,
    reason: overview.executorAvailable
      ? 'This backend does not report the action yet.'
      : 'No workflow worker is running.',
  }
}

/** The lowest language version that can hold every action in the graph. */
export function requiredSchemaVersion(graph: AutomationGraph): number {
  return Math.max(
    1,
    ...graph.nodes.map((node) =>
      node.action ? WORKFLOW_ACTIONS[node.action.type].minSchemaVersion : 1
    )
  )
}
