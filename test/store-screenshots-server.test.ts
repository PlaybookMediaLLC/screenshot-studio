import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { createRequire, Module } from 'node:module'
import { test } from 'node:test'

// The crypto module imports 'server-only'; stub it for the plain runner.
const localRequire = createRequire(__filename)
const serverOnlyPath = localRequire.resolve('server-only')
const serverOnlyStub = new Module(serverOnlyPath)
serverOnlyStub.loaded = true
localRequire.cache[serverOnlyPath] = serverOnlyStub

process.env.BETTER_AUTH_SECRET = 'test-secret-for-review-links'
process.env.STORE_PUBLISHING_ENCRYPTION_KEY = randomBytes(32).toString('base64')

const tokens = import('../lib/tenant/store-review-token')
const crypto = import('../lib/tenant/store-credential-crypto')

const claim = {
  reviewId: 'clx0review0001',
  organizationId: 'org_123',
  shareTokenId: 'share-token-abc',
}

test('review tokens round-trip and stay routable (no dots: the proxy skips dotted paths)', async () => {
  const { createStoreReviewToken, verifyStoreReviewToken } = await tokens
  const token = createStoreReviewToken(claim)
  assert.equal(token.includes('.'), false)
  assert.match(token, /^[A-Za-z0-9_~-]+$/)
  assert.deepEqual(verifyStoreReviewToken(token), claim)
})

test('review tokens reject tampering, other secrets, and junk', async () => {
  const { createStoreReviewToken, verifyStoreReviewToken } = await tokens
  const token = createStoreReviewToken(claim)
  const [payload, signature] = token.split('~')
  const forged = Buffer.from(
    JSON.stringify([claim.reviewId, 'org_other', claim.shareTokenId])
  ).toString('base64url')
  assert.equal(verifyStoreReviewToken(`${forged}~${signature}`), null)
  assert.equal(verifyStoreReviewToken(`${payload}~${signature.slice(0, -1)}A`), null)
  assert.equal(verifyStoreReviewToken(`${token}~extra`), null)
  assert.equal(verifyStoreReviewToken('not-a-token'), null)
  assert.equal(verifyStoreReviewToken(undefined), null)
  process.env.BETTER_AUTH_SECRET = 'rotated'
  assert.equal(verifyStoreReviewToken(token), null)
  process.env.BETTER_AUTH_SECRET = 'test-secret-for-review-links'
})

test('credential secrets round-trip, never appear in the envelope, and fail closed', async () => {
  const {
    decryptStoreCredential,
    encryptStoreCredential,
    isStoreCredentialEncryptionConfigured,
    StoreCredentialKeyError,
  } = await crypto
  const secret = '{"private_key":"-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----"}'
  const envelope = encryptStoreCredential(secret)
  assert.equal(envelope.includes('PRIVATE'), false)
  assert.notEqual(encryptStoreCredential(secret), envelope, 'a fresh IV each time')
  assert.equal(decryptStoreCredential(envelope), secret)
  const [iv, tag, body] = envelope.split('.')
  const flipped = Buffer.from(body, 'base64url')
  flipped[0] ^= 1
  assert.throws(() => decryptStoreCredential([iv, tag, flipped.toString('base64url')].join('.')))
  const key = process.env.STORE_PUBLISHING_ENCRYPTION_KEY
  process.env.STORE_PUBLISHING_ENCRYPTION_KEY = randomBytes(32).toString('base64')
  assert.throws(() => decryptStoreCredential(envelope), 'a rotated key cannot read old secrets')
  process.env.STORE_PUBLISHING_ENCRYPTION_KEY = 'short'
  assert.equal(isStoreCredentialEncryptionConfigured(), false)
  assert.throws(() => encryptStoreCredential(secret), StoreCredentialKeyError)
  process.env.STORE_PUBLISHING_ENCRYPTION_KEY = key
})
