const invalidPathSegment = /[^a-zA-Z0-9._-]/

export const assetClassifications = ['capture', 'derived', 'export', 'input'] as const

export type AssetClassification = (typeof assetClassifications)[number]

export class InvalidTenantObjectKeyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidTenantObjectKeyError'
  }
}

export type TenantObjectKeyInput = {
  assetId: string
  classification: AssetClassification
  fileName: string
  organizationId: string
  revision: number
}

function getSafeSegment(value: string): string {
  if (!value || value === '.' || value === '..' || invalidPathSegment.test(value)) {
    throw new InvalidTenantObjectKeyError('Storage path segments contain unsafe characters.')
  }

  return value
}

export function assertTenantObjectKey(organizationId: string, objectKey: string): void {
  if (!objectKey.startsWith(`org/${getSafeSegment(organizationId)}/`)) {
    throw new InvalidTenantObjectKeyError('The object key is outside the active organization.')
  }
}

export function buildTenantObjectKey(input: TenantObjectKeyInput): string {
  const revision = Number.isSafeInteger(input.revision) && input.revision > 0 ? input.revision : 1
  return [
    'org',
    getSafeSegment(input.organizationId),
    input.classification,
    getSafeSegment(input.assetId),
    revision.toString(),
    getSafeSegment(input.fileName),
  ].join('/')
}
