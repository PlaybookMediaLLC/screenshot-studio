export const apiKeyScopes = [
  'artifact:read',
  'asset:write',
  'release:create',
  'source:write',
  'upload:sign',
] as const

export type ApiKeyScope = (typeof apiKeyScopes)[number]

export const apiKeyScopePermissions: Record<ApiKeyScope, Record<string, string[]>> = {
  'artifact:read': { artifact: ['read'] },
  'asset:write': { asset: ['write'] },
  'release:create': { release: ['create'] },
  'source:write': { source: ['write'] },
  'upload:sign': { upload: ['sign'] },
}
