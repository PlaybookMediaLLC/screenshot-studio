import type {
  AutomationFamily,
  AutomationGraph,
  AutomationEventSnapshot,
  AutomationLayout,
} from 'screenshot-studio-backend-sdk'

/** A complete draft/review path with an intentional else outcome. */
export function initialReleaseWorkflow(
  family: AutomationFamily,
  brandKitId = '',
  destinationId = ''
): AutomationGraph {
  const qualification =
    family === 'release.published'
      ? { field: 'release.tag', operator: 'glob', values: ['v*'] }
      : family === 'pull_request.merged'
        ? { field: 'pr.base', operator: 'eq', values: ['main'] }
        : { field: 'deployment.environment', operator: 'eq', values: ['production'] }
  const condition =
    family === 'release.published'
      ? { field: 'release.prerelease', operator: 'is_false' }
      : family === 'pull_request.merged'
        ? {
            group: 'ALL' as const,
            children: [
              { field: 'pr.labels', operator: 'contains', values: ['release'] },
              { field: 'pr.bot', operator: 'is_false' },
              { field: 'pr.files', operator: 'glob', values: ['src/*'] },
            ],
          }
        : { field: 'deployment.state', operator: 'eq', values: ['success'] }
  return {
    schemaVersion: 1,
    family,
    qualification,
    nodes: [
      { id: 'trigger', type: 'trigger' },
      { id: 'condition', type: 'condition', condition },
      { id: 'release', type: 'action', action: { type: 'create_release' } },
      {
        id: 'campaign',
        type: 'action',
        action: {
          type: 'create_campaign',
          input: { nodeId: 'release', output: 'releaseId' },
          brandKitId,
          destinationIds: destinationId ? [destinationId] : [],
        },
      },
      {
        id: 'review',
        type: 'action',
        action: { type: 'submit_review', input: { nodeId: 'campaign', output: 'campaignId' } },
      },
      { id: 'done', type: 'end', outcome: 'completed' },
      { id: 'skip', type: 'end', outcome: 'skipped' },
    ],
    edges: [
      { from: 'trigger', to: 'condition', branch: 'next' },
      { from: 'condition', to: 'release', branch: 'true' },
      { from: 'condition', to: 'skip', branch: 'false' },
      { from: 'release', to: 'campaign', branch: 'next' },
      { from: 'campaign', to: 'review', branch: 'next' },
      { from: 'review', to: 'done', branch: 'next' },
    ],
  }
}

/** Positions are intentionally absent from execution graphs and their hashes. */
export const initialReleaseLayout: AutomationLayout = {
  trigger: { x: 40, y: 0 },
  condition: { x: 40, y: 95 },
  release: { x: -24, y: 230 },
  campaign: { x: -24, y: 325 },
  review: { x: -24, y: 420 },
  done: { x: -24, y: 515 },
  skip: { x: 320, y: 230 },
}

/** Explicitly synthetic evidence for free, side-effect-free preview. */
export function releaseExample(
  family: AutomationFamily,
  repositoryId: string,
  variant = 'match'
): AutomationEventSnapshot {
  const event: AutomationEventSnapshot = {
    family,
    semanticKey: 'example',
    repositoryId,
    repositoryName: 'example/product',
    objectId: '101',
    occurredAt: '2026-10-19T10:00:00Z',
    origin: 'example',
    title: 'Faster exports',
    notes: 'Exports now finish faster.',
    url: '',
    fields: {
      'repository.id': { state: 'available', values: [repositoryId] },
      'event.family': { state: 'available', values: [family] },
      'actor.login': { state: 'available', values: ['example-author'] },
    },
  }
  if (family === 'release.published')
    Object.assign(event.fields, {
      'event.action': { state: 'available', values: ['published'] },
      'release.tag': { state: 'available', values: ['v1.0.0'] },
      'release.title': { state: 'available', values: [event.title] },
      'release.prerelease': { state: 'available', boolean: variant === 'else' },
    })
  if (family === 'pull_request.merged') {
    event.number = 101
    event.defaultBranch = 'main'
    Object.assign(event.fields, {
      'event.action': { state: 'available', values: ['closed'] },
      'pr.base': { state: 'available', values: ['main'] },
      'pr.title': { state: 'available', values: [event.title] },
      'pr.author': { state: 'available', values: ['example-author'] },
      'pr.bot': { state: 'available', boolean: false },
      'pr.labels': { state: 'available', values: variant === 'else' ? [] : ['release'] },
      'pr.files':
        variant === 'pending'
          ? { state: 'pending' }
          : { state: 'available', values: ['src/export.ts'] },
    })
  }
  if (family === 'deployment.succeeded')
    Object.assign(event.fields, {
      'event.action': { state: 'available', values: ['success'] },
      'deployment.environment': {
        state: 'available',
        values: variant === 'else' ? ['preview'] : ['production'],
      },
      'deployment.state': { state: 'available', values: ['success'] },
      'deployment.production': { state: 'available', boolean: true },
      'deployment.sha': { state: 'available', values: ['0123456789abcdef'] },
    })
  return event
}
