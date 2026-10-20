import { z } from 'zod'
import {
  automationFamilySchema,
  type AutomationCondition,
  type AutomationGraph,
  type AutomationLayout,
  type AutomationNode,
} from '@/lib/api/contracts/release-automation'

/** Templates that open as editable, executable definitions. */
export const workflowTemplateIdSchema = z.enum([
  'release-launch',
  'feature-announcement',
  'deployment-marketing',
])

/** One template identifier. */
export type WorkflowTemplateId = z.infer<typeof workflowTemplateIdSchema>

/** What a template needs from the workspace before it can be saved. */
export const workflowTemplateInputSchema = z.strictObject({
  brandKitId: z.string().max(64),
  destinationIds: z.array(z.string().max(64)).max(10),
  /** Adds paid AI copy generation with this credit budget; 0 leaves it out. */
  creditLimit: z.number().int().min(0).max(500),
  /** The pull-request base branch a feature announcement requires. */
  branch: z.string().max(255),
})

/** Template parameters chosen in the template picker. */
export type WorkflowTemplateInput = z.infer<typeof workflowTemplateInputSchema>

/** Display facts for one template. */
export const workflowTemplateSchema = z.strictObject({
  id: workflowTemplateIdSchema,
  family: automationFamilySchema,
  name: z.string(),
  description: z.string(),
  steps: z.array(z.string()),
})

/** One template's display facts. */
export type WorkflowTemplate = z.infer<typeof workflowTemplateSchema>

/** The executable templates, in the order the picker shows them. */
export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    id: 'release-launch',
    family: 'release.published',
    name: 'Product launch from a GitHub release',
    description:
      'When a stable release is published, create a release and campaign drafts, optionally write channel copy with AI, and send them for review.',
    steps: [
      'Release published',
      'Stable version tag',
      'Create release',
      'Campaign drafts',
      'Review',
    ],
  },
  {
    id: 'feature-announcement',
    family: 'pull_request.merged',
    name: 'Feature announcement from a merged pull request',
    description:
      'When a labeled, human-authored pull request merges into your branch, announce it. Qualification is rule-based (labels and paths), not AI relevance scoring.',
    steps: [
      'PR merged',
      'Watched branch',
      'Feature label',
      'Create release',
      'Campaign drafts',
      'Review',
    ],
  },
  {
    id: 'deployment-marketing',
    family: 'deployment.succeeded',
    name: 'Deployment-driven marketing',
    description:
      'When a production deployment succeeds, draft a campaign for review. Production capture of your product surfaces still runs for every production deployment.',
    steps: ['Deployment succeeded', 'Production', 'Create release', 'Campaign drafts', 'Review'],
  },
]

function rules(id: WorkflowTemplateId, branch: string) {
  const qualification: Record<WorkflowTemplateId, AutomationCondition> = {
    'release-launch': { field: 'release.tag', operator: 'glob', values: ['v*'] },
    'feature-announcement': {
      group: 'ALL',
      children: [
        { field: 'pr.base', operator: 'eq', values: [branch || 'main'] },
        { field: 'pr.bot', operator: 'is_false' },
      ],
    },
    'deployment-marketing': {
      field: 'deployment.environment',
      operator: 'eq',
      values: ['production'],
    },
  }
  const condition: Record<WorkflowTemplateId, AutomationCondition> = {
    'release-launch': { field: 'release.prerelease', operator: 'is_false' },
    'feature-announcement': {
      group: 'ANY',
      children: [
        { field: 'pr.labels', operator: 'in', values: ['feature', 'marketing', 'release'] },
        { field: 'pr.title', operator: 'starts_with', values: ['feat'] },
      ],
    },
    'deployment-marketing': { field: 'deployment.production', operator: 'is_true' },
  }
  return { qualification: qualification[id], condition: condition[id] }
}

/**
 * Builds a template's graph and canvas layout. The graph is an ordinary
 * draft: every condition and action stays editable before activation, and
 * the Go validator remains the authority on whether it can run.
 */
export function buildWorkflowTemplate(
  id: WorkflowTemplateId,
  input: WorkflowTemplateInput
): { graph: AutomationGraph; layout: AutomationLayout } {
  const template = WORKFLOW_TEMPLATES.find((candidate) => candidate.id === id)
  if (!template) throw new Error(`Unknown workflow template ${id}`)
  const { qualification, condition } = rules(id, input.branch)
  const generate = input.creditLimit > 0
  const reviewInput = generate ? 'copy' : 'campaign'
  const nodes: AutomationNode[] = [
    { id: 'trigger', type: 'trigger' },
    { id: 'condition', type: 'condition', condition },
    { id: 'release', type: 'action', action: { type: 'create_release' } },
    {
      id: 'campaign',
      type: 'action',
      action: {
        type: 'create_campaign',
        input: { nodeId: 'release', output: 'releaseId' },
        brandKitId: input.brandKitId,
        destinationIds: input.destinationIds,
      },
    },
    ...(generate
      ? [
          {
            id: 'copy',
            type: 'action' as const,
            action: {
              type: 'generate_copy' as const,
              input: { nodeId: 'campaign', output: 'campaignId' },
              creditLimit: input.creditLimit,
            },
          },
        ]
      : []),
    {
      id: 'review',
      type: 'action',
      action: { type: 'submit_review', input: { nodeId: reviewInput, output: 'campaignId' } },
    },
    { id: 'done', type: 'end', outcome: 'completed' },
    { id: 'skip', type: 'end', outcome: 'skipped' },
  ]
  const edges = [
    { from: 'trigger', to: 'condition', branch: 'next' },
    { from: 'condition', to: 'release', branch: 'true' },
    { from: 'condition', to: 'skip', branch: 'false' },
    { from: 'release', to: 'campaign', branch: 'next' },
    ...(generate
      ? [
          { from: 'campaign', to: 'copy', branch: 'next' },
          { from: 'copy', to: 'review', branch: 'next' },
        ]
      : [{ from: 'campaign', to: 'review', branch: 'next' }]),
    { from: 'review', to: 'done', branch: 'next' },
  ]
  const layout: AutomationLayout = { skip: { x: 340, y: 230 } }
  let y = 0
  for (const node of nodes) {
    if (node.id === 'skip') continue
    layout[node.id] = { x: 0, y }
    y += node.type === 'condition' ? 130 : 110
  }
  return {
    graph: {
      schemaVersion: generate ? 2 : 1,
      family: template.family,
      qualification,
      nodes,
      edges,
    },
    layout,
  }
}
