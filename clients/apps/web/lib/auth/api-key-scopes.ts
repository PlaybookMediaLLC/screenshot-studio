export const apiKeyScopes = [
  'artifact:read',
  'asset:write',
  'draft:comment',
  'draft:write',
  'onboarding:run',
  'post:schedule',
  'queue:write',
  'release:create',
  'source:write',
  'upload:sign',
] as const

export type ApiKeyScope = (typeof apiKeyScopes)[number]

export const apiKeyScopePermissions: Record<ApiKeyScope, Record<string, string[]>> = {
  'artifact:read': { artifact: ['read'] },
  'asset:write': { asset: ['write'] },
  'draft:comment': { draft: ['comment'] },
  'draft:write': { draft: ['write'] },
  'onboarding:run': { onboarding: ['run'] },
  'post:schedule': { post: ['schedule'] },
  'queue:write': { queue: ['write'] },
  'release:create': { release: ['create'] },
  'source:write': { source: ['write'] },
  'upload:sign': { upload: ['sign'] },
}

/** What each scope lets a key do, for the reference, settings, and agent consent. */
export const apiKeyScopeDescriptions: Record<ApiKeyScope, string> = {
  'artifact:read':
    'Read releases, campaigns, the review queue, the publishing schedule, and link previews; sign asset downloads; use the editor utilities.',
  'asset:write': 'Complete and delete asset uploads.',
  'draft:comment':
    'Add, reply, edit your own comments, and resolve discussions on workspace drafts. Never approves or publishes.',
  'draft:write': 'Create, update, and delete content drafts. Only a person schedules a draft.',
  'onboarding:run': 'Read a product site into its profile and follow the run.',
  'post:schedule':
    'Schedule campaign posts and visuals a person approved, and cancel scheduled posts. It never approves anything.',
  'release:create': 'Create releases and draft campaigns, and submit drafts for review.',
  'queue:write':
    'Change future posting-slot suggestions and time zones. Does not approve, schedule, or move existing posts.',
  'source:write': 'Register and update release-intake sources.',
  'upload:sign': 'Sign asset uploads.',
}

/** Combine explicitly selected scopes without dropping actions on a shared resource. */
export function permissionsForApiKeyScopes(
  scopes: readonly ApiKeyScope[]
): Record<string, string[]> {
  const permissions: Record<string, string[]> = {}
  for (const scope of scopes) {
    for (const [resource, actions] of Object.entries(apiKeyScopePermissions[scope])) {
      permissions[resource] = [...new Set([...(permissions[resource] ?? []), ...actions])]
    }
  }
  return permissions
}
