export const apiKeyScopes = [
  'artifact:read',
  'asset:write',
  'draft:write',
  'post:schedule',
  'release:create',
  'source:write',
  'upload:sign',
] as const

export type ApiKeyScope = (typeof apiKeyScopes)[number]

export const apiKeyScopePermissions: Record<ApiKeyScope, Record<string, string[]>> = {
  'artifact:read': { artifact: ['read'] },
  'asset:write': { asset: ['write'] },
  'draft:write': { draft: ['write'] },
  'post:schedule': { post: ['schedule'] },
  'release:create': { release: ['create'] },
  'source:write': { source: ['write'] },
  'upload:sign': { upload: ['sign'] },
}

/** What each scope lets a key do, for the reference, settings, and agent consent. */
export const apiKeyScopeDescriptions: Record<ApiKeyScope, string> = {
  'artifact:read':
    'Read releases, campaigns, the review queue, the publishing schedule, and link previews; sign asset downloads; use the editor utilities.',
  'asset:write': 'Complete and delete asset uploads.',
  'draft:write': 'Create, update, and delete content drafts. Only a person schedules a draft.',
  'post:schedule':
    'Schedule campaign posts and visuals a person approved, and cancel scheduled posts. It never approves anything.',
  'release:create': 'Create releases and draft campaigns, and submit drafts for review.',
  'source:write': 'Register and update release-intake sources.',
  'upload:sign': 'Sign asset uploads.',
}
