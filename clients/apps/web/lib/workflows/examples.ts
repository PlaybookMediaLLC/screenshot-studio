import type { AutomationEvent, AutomationFamily } from '@/lib/api/contracts/release-automation'

/** Version fields for an example version name, as the backend derives them. */
function versionFields(major: number, minor: number, patch: number, prerelease = '') {
  const level = prerelease ? 'prerelease' : patch ? 'patch' : minor ? 'minor' : 'major'
  const value = (text: string) => ({ state: 'available', values: [text] })
  return {
    'version.major': value(String(major)),
    'version.minor': value(String(minor)),
    'version.patch': value(String(patch)),
    'version.prerelease': value(prerelease),
    'version.level': value(level),
  }
}

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
      ...versionFields(1, 0, variant === 'else' ? 1 : 0),
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
      'pr.head': { state: 'available', values: ['feature/faster-exports'] },
      'pr.additions': { state: 'available', values: ['240'] },
      'pr.deletions': { state: 'available', values: ['32'] },
      'pr.changed_files': { state: 'available', values: ['6'] },
      'pr.commits': { state: 'available', values: ['4'] },
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
  if (family === 'tag.pushed') {
    const tag = variant === 'else' ? 'v2.4.1' : 'v2.4.0'
    event.title = tag
    Object.assign(event.fields, {
      'event.action': { state: 'available', values: ['created'] },
      'tag.name': { state: 'available', values: [tag] },
      ...versionFields(2, 4, variant === 'else' ? 1 : 0),
    })
  }
  if (family === 'milestone.closed') {
    event.number = 7
    event.title = 'v2.4'
    Object.assign(event.fields, {
      'event.action': { state: 'available', values: ['closed'] },
      'milestone.title': { state: 'available', values: ['v2.4'] },
      'milestone.closed_items': { state: 'available', values: ['12'] },
      'milestone.open_items': { state: 'available', values: [variant === 'else' ? '2' : '0'] },
      ...versionFields(2, 4, 0),
    })
  }
  return event
}
