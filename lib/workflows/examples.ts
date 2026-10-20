import type { AutomationEvent, AutomationFamily } from '@/lib/api/contracts/release-automation'

/** Explicitly synthetic evidence for free, side-effect-free preview. */
export function releaseExample(
  family: AutomationFamily,
  repositoryId: string,
  variant = 'match'
): AutomationEvent {
  const event: AutomationEvent = {
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
      'repository.name': { state: 'available', values: ['example/product'] },
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
      'pr.number': { state: 'available', values: ['101'] },
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
