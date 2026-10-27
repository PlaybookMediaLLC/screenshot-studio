import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { z } from 'zod'

/**
 * Provider credentials are sealed here, with a key only the web facade holds,
 * before the backend stores them: AES-256-GCM, `v1.<iv>.<tag>.<ciphertext>`.
 */

/** What a connection stores, sealed. */
export const credentialsSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1).optional(),
})
/** Provider credentials. */
export type Credentials = z.infer<typeof credentialsSchema>

function key(): Buffer {
  const encoded = process.env.INTEGRATION_ENCRYPTION_KEY
  const value = encoded ? Buffer.from(encoded, 'base64') : Buffer.alloc(0)
  if (value.length !== 32) {
    throw new Error('INTEGRATION_ENCRYPTION_KEY must be a base64-encoded 32-byte key.')
  }
  return value
}

/** True when credentials can be sealed: the key is set and well formed. */
export function canSealCredentials(): boolean {
  try {
    key()
    return true
  } catch {
    return false
  }
}

/** Seal credentials for storage. */
export function sealCredentials(credentials: Credentials): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const data = Buffer.concat([
    cipher.update(JSON.stringify(credentialsSchema.parse(credentials)), 'utf8'),
    cipher.final(),
  ])
  return ['v1', iv, cipher.getAuthTag(), data]
    .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
    .join('.')
}

/** Open sealed credentials; throws when they were sealed with another key or changed. */
export function openCredentials(sealed: string): Credentials {
  const [version, iv, tag, data] = sealed.split('.')
  if (version !== 'v1' || !iv || !tag || !data)
    throw new Error('The stored credentials are not readable.')
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'))
  decipher.setAuthTag(Buffer.from(tag, 'base64url'))
  const plain = Buffer.concat([
    decipher.update(Buffer.from(data, 'base64url')),
    decipher.final(),
  ]).toString('utf8')
  return credentialsSchema.parse(JSON.parse(plain))
}
