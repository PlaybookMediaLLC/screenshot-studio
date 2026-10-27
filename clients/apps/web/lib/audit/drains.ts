import 'server-only'

import { createCipheriv, randomBytes } from 'node:crypto'

function getEncryptionKey(): Buffer {
  const encodedKey = process.env.AUDIT_DRAIN_ENCRYPTION_KEY
  const key = encodedKey ? Buffer.from(encodedKey, 'base64') : Buffer.alloc(0)
  if (key.length !== 32) {
    throw new Error('AUDIT_DRAIN_ENCRYPTION_KEY must be a base64-encoded 32-byte key.')
  }

  return key
}

/** Seals a drain secret in the format the Go maintenance worker decrypts. */
export function encryptDrainSecret(secret: string): string {
  const initializationVector = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', getEncryptionKey(), initializationVector)
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()])
  return [initializationVector, cipher.getAuthTag(), encrypted]
    .map((part) => part.toString('base64url'))
    .join('.')
}
