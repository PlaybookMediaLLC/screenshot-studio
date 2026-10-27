import 'server-only'

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

/**
 * Encryption for store publishing credentials (App Store Connect keys and
 * Google Play service accounts). The web encrypts before sending to the
 * backend and decrypts only inside an upload request, so the database and
 * the backend only ever hold ciphertext. AES-256-GCM, `iv.tag.ciphertext`
 * in base64url, the same envelope as audit drain secrets.
 */

/** The key is missing or malformed. */
export class StoreCredentialKeyError extends Error {
  /** Create a configuration error. */
  constructor() {
    super('STORE_PUBLISHING_ENCRYPTION_KEY must be a base64-encoded 32-byte key.')
    this.name = 'StoreCredentialKeyError'
  }
}

function key(): Buffer {
  const encoded = process.env.STORE_PUBLISHING_ENCRYPTION_KEY
  const value = encoded ? Buffer.from(encoded, 'base64') : Buffer.alloc(0)
  if (value.length !== 32) throw new StoreCredentialKeyError()
  return value
}

/** Whether credential storage is configured on this server. */
export function isStoreCredentialEncryptionConfigured(): boolean {
  try {
    key()
    return true
  } catch {
    return false
  }
}

/** Encrypt a credential secret. */
export function encryptStoreCredential(secret: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()])
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString('base64url')).join('.')
}

/** Decrypt a credential secret; throws if it was tampered with or the key changed. */
export function decryptStoreCredential(envelope: string): string {
  const [iv, tag, ciphertext] = envelope.split('.').map((part) => Buffer.from(part, 'base64url'))
  if (!iv || !tag || !ciphertext) throw new Error('The stored credential is unreadable.')
  const decipher = createDecipheriv('aes-256-gcm', key(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}
