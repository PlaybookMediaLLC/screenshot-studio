import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, verify, type KeyObject } from 'node:crypto'
import { createRequire, Module } from 'node:module'
import { test } from 'node:test'

// Both clients import 'server-only', which throws outside the react-server
// condition. Stub it so this file runs under the plain `tsx --test` runner.
const localRequire = createRequire(__filename)
const serverOnlyPath = localRequire.resolve('server-only')
const serverOnlyStub = new Module(serverOnlyPath)
serverOnlyStub.loaded = true
localRequire.cache[serverOnlyPath] = serverOnlyStub
const ascModule = import('../lib/integrations/app-store-connect')
const playModule = import('../lib/integrations/google-play')

const NOW = Date.UTC(2026, 9, 16, 12, 0, 0)
const ASC = 'https://api.appstoreconnect.apple.com/v1'
const PLAY =
  'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/com.example.app'
const PLAY_UPLOAD =
  'https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/com.example.app'

const ec = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 })

function ascCreds() {
  return {
    issuerId: 'issuer-1',
    keyId: 'KEY123',
    privateKeyPem: ec.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  }
}

function playCreds() {
  return {
    client_email: 'publisher@example.iam.gserviceaccount.com',
    private_key: rsa.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  }
}

type Recorded = { url: string; method: string; headers: Headers; body: RequestInit['body'] }

/** A fetch that answers from a queue and records every request. */
function fakeFetch(...responses: Response[]) {
  const calls: Recorded[] = []
  const sleeps: number[] = []
  const fetch = async (url: string, init: RequestInit = {}) => {
    calls.push({
      url,
      method: init.method ?? 'GET',
      headers: new Headers(init.headers),
      body: init.body,
    })
    const next = responses.shift()
    if (!next) throw new Error(`unexpected request ${init.method ?? 'GET'} ${url}`)
    return next
  }
  const sleep = async (ms: number) => {
    sleeps.push(ms)
  }
  return { calls, sleeps, options: { fetch, sleep, now: () => NOW } }
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

function readJwt(token: string) {
  const [header, payload, signature] = token.split('.')
  return {
    header: JSON.parse(Buffer.from(header, 'base64url').toString()),
    payload: JSON.parse(Buffer.from(payload, 'base64url').toString()),
    signed: Buffer.from(`${header}.${payload}`),
    signature: Buffer.from(signature, 'base64url'),
  }
}

function bearer(call: Recorded): string {
  return (call.headers.get('authorization') ?? '').replace(/^Bearer /, '')
}

function bodyText(call: Recorded): string {
  return typeof call.body === 'string' ? call.body : ''
}

function bodyBytes(call: Recorded): number[] {
  const body: unknown = call.body
  assert.ok(body instanceof Uint8Array, 'body is raw bytes')
  return [...body]
}

function verifyRs256(token: string, key: KeyObject) {
  const jwt = readJwt(token)
  assert.ok(verify('RSA-SHA256', jwt.signed, key, jwt.signature), 'RS256 signature verifies')
  return jwt
}

function screenshot(id: string, fileName: string, checksum: string | null, state: string) {
  return {
    type: 'appScreenshots',
    id,
    attributes: { fileName, sourceFileChecksum: checksum, assetDeliveryState: { state } },
  }
}

test('ASC signs an ES256 token and follows links.next pagination', async () => {
  const { listApps } = await ascModule
  const app = (id: string) => ({
    type: 'apps',
    id,
    attributes: { name: `App ${id}`, bundleId: `com.example.${id}`, primaryLocale: 'en-US' },
  })
  const next = `${ASC}/apps?limit=200&cursor=Mg`
  const fake = fakeFetch(
    json({ data: [app('1')], links: { next } }),
    json({ data: [app('2')], links: {} })
  )

  const apps = await listApps(ascCreds(), fake.options)

  assert.deepEqual(
    apps.map((a) => a.id),
    ['1', '2']
  )
  assert.equal(apps[0].bundleId, 'com.example.1')
  assert.deepEqual(
    fake.calls.map((c) => c.url),
    [`${ASC}/apps?limit=200`, next]
  )
  const jwt = readJwt(bearer(fake.calls[0]))
  assert.deepEqual(jwt.header, { alg: 'ES256', kid: 'KEY123', typ: 'JWT' })
  const iat = Math.floor(NOW / 1000)
  assert.deepEqual(jwt.payload, {
    iss: 'issuer-1',
    iat,
    exp: iat + 1200,
    aud: 'appstoreconnect-v1',
  })
  const valid = verify(
    'sha256',
    jwt.signed,
    { key: ec.publicKey, dsaEncoding: 'ieee-p1363' },
    jwt.signature
  )
  assert.ok(valid, 'ES256 signature verifies')
})

test('ASC refuses to send the token to a links.next outside the API host', async () => {
  const { listApps, AppStoreConnectError } = await ascModule
  const fake = fakeFetch(json({ data: [], links: { next: 'https://evil.example/apps' } }))
  await assert.rejects(listApps(ascCreds(), fake.options), AppStoreConnectError)
  assert.equal(fake.calls.length, 1)
})

test('ASC versions are filtered by state and flagged editable', async () => {
  const { listAppStoreVersions } = await ascModule
  const version = (id: string, appStoreState: string) => ({
    type: 'appStoreVersions',
    id,
    attributes: { versionString: '1.0', platform: 'IOS', appStoreState },
  })
  const fake = fakeFetch(
    json({ data: [version('v1', 'PREPARE_FOR_SUBMISSION'), version('v2', 'READY_FOR_SALE')] })
  )

  const versions = await listAppStoreVersions(ascCreds(), 'app1', fake.options)

  assert.deepEqual(
    versions.map((v) => [v.id, v.editable]),
    [
      ['v1', true],
      ['v2', false],
    ]
  )
  assert.equal(
    fake.calls[0].url,
    `${ASC}/apps/app1/appStoreVersions?filter[appStoreState]=PREPARE_FOR_SUBMISSION,DEVELOPER_REJECTED,REJECTED,METADATA_REJECTED,WAITING_FOR_REVIEW,IN_REVIEW,READY_FOR_SALE&limit=50`
  )
})

test('ASC screenshot sets resolve included screenshots in relationship order', async () => {
  const { listScreenshotSets } = await ascModule
  const fake = fakeFetch(
    json({
      data: [
        {
          type: 'appScreenshotSets',
          id: 'set1',
          attributes: { screenshotDisplayType: 'APP_IPHONE_67' },
          relationships: {
            appScreenshots: {
              data: [
                { type: 'appScreenshots', id: 's2' },
                { type: 'appScreenshots', id: 's1' },
              ],
            },
          },
        },
      ],
      included: [
        screenshot('s1', 'a.png', 'x', 'COMPLETE'),
        screenshot('s2', 'b.png', 'y', 'COMPLETE'),
      ],
    })
  )

  const sets = await listScreenshotSets(ascCreds(), 'loc1', fake.options)

  assert.equal(sets[0].displayType, 'APP_IPHONE_67')
  assert.deepEqual(
    sets[0].screenshots.map((s) => s.fileName),
    ['b.png', 'a.png']
  )
  assert.match(
    fake.calls[0].url,
    /\/appStoreVersionLocalizations\/loc1\/appScreenshotSets\?include=appScreenshots/
  )
})

test('ASC upload skips a screenshot already uploaded with the same name and checksum', async () => {
  const { uploadScreenshot } = await ascModule
  const bytes = new Uint8Array([1, 2, 3, 4, 5])
  const md5 = createHash('md5').update(bytes).digest('hex')
  const fake = fakeFetch(json({ data: [screenshot('shot1', 'home.png', md5, 'COMPLETE')] }))

  const result = await uploadScreenshot(
    ascCreds(),
    'set1',
    { fileName: 'home.png', bytes },
    fake.options
  )

  assert.deepEqual(result, { id: 'shot1', state: 'COMPLETE' })
  assert.equal(fake.calls.length, 1)
  assert.equal(fake.calls[0].method, 'GET')
  assert.equal(fake.calls[0].url, `${ASC}/appScreenshotSets/set1/appScreenshots?limit=50`)
})

test('ASC upload reserves, sends byte ranges without auth, and commits with the MD5', async () => {
  const { uploadScreenshot } = await ascModule
  const bytes = new Uint8Array([10, 11, 12, 13, 14])
  const md5 = createHash('md5').update(bytes).digest('hex')
  const operation = (offset: number, length: number, part: string) => ({
    method: 'PUT',
    url: `https://upload.example.apple.com/part${part}`,
    offset,
    length,
    requestHeaders: [
      { name: 'Content-Type', value: 'image/png' },
      { name: 'x-part', value: part },
    ],
  })
  const fake = fakeFetch(
    // An older attempt with the same name but a different checksum does not count.
    json({ data: [screenshot('old', 'home.png', 'different', 'COMPLETE')] }),
    json(
      {
        data: {
          type: 'appScreenshots',
          id: 'shot9',
          attributes: { uploadOperations: [operation(0, 3, '1'), operation(3, 2, '2')] },
        },
      },
      201
    ),
    new Response(null, { status: 200 }),
    new Response(null, { status: 200 }),
    json({ data: screenshot('shot9', 'home.png', md5, 'UPLOAD_COMPLETE') })
  )

  const result = await uploadScreenshot(
    ascCreds(),
    'set1',
    { fileName: 'home.png', bytes },
    fake.options
  )

  assert.deepEqual(result, { id: 'shot9', state: 'UPLOAD_COMPLETE' })
  const [, reserve, part1, part2, commit] = fake.calls
  assert.equal(reserve.method, 'POST')
  assert.equal(reserve.url, `${ASC}/appScreenshots`)
  assert.deepEqual(JSON.parse(bodyText(reserve)), {
    data: {
      type: 'appScreenshots',
      attributes: { fileName: 'home.png', fileSize: 5 },
      relationships: { appScreenshotSet: { data: { type: 'appScreenshotSets', id: 'set1' } } },
    },
  })
  assert.equal(part1.url, 'https://upload.example.apple.com/part1')
  assert.equal(part1.method, 'PUT')
  assert.deepEqual(bodyBytes(part1), [10, 11, 12])
  assert.deepEqual(bodyBytes(part2), [13, 14])
  for (const part of [part1, part2]) {
    assert.equal(part.headers.get('authorization'), null, 'no Apple token on upload URLs')
    assert.equal(part.headers.get('content-type'), 'image/png')
  }
  assert.equal(part2.headers.get('x-part'), '2')
  assert.equal(commit.method, 'PATCH')
  assert.equal(commit.url, `${ASC}/appScreenshots/shot9`)
  assert.deepEqual(JSON.parse(bodyText(commit)), {
    data: {
      type: 'appScreenshots',
      id: 'shot9',
      attributes: { uploaded: true, sourceFileChecksum: md5 },
    },
  })
})

test('ASC retries a 429 after the Retry-After delay, then succeeds', async () => {
  const { listApps } = await ascModule
  const fake = fakeFetch(
    json({ errors: [{ status: '429', detail: 'slow down' }] }, 429, { 'retry-after': '7' }),
    json({ data: [] })
  )

  assert.deepEqual(await listApps(ascCreds(), fake.options), [])
  assert.deepEqual(fake.sleeps, [7000])
  assert.equal(fake.calls.length, 2)
})

test('ASC does not retry the screenshot reservation after a 429', async () => {
  const { uploadScreenshot, AppStoreConnectError } = await ascModule
  const fake = fakeFetch(json({ data: [] }), json({ errors: [] }, 429, { 'retry-after': '1' }))

  await assert.rejects(
    uploadScreenshot(
      ascCreds(),
      'set1',
      { fileName: 'a.png', bytes: new Uint8Array([1]) },
      fake.options
    ),
    (error) => error instanceof AppStoreConnectError && error.code === 'rate-limited'
  )
  assert.equal(fake.calls.filter((c) => c.method === 'POST').length, 1)
  assert.deepEqual(fake.sleeps, [])
})

test('ASC maps 401 to unauthorized without leaking the token', async () => {
  const { listApps, AppStoreConnectError } = await ascModule
  const fake = fakeFetch(
    json({ errors: [{ status: '401', detail: 'Provide a properly signed token.' }] }, 401)
  )

  const error = await listApps(ascCreds(), fake.options).catch((e: unknown) => e)

  assert.ok(error instanceof AppStoreConnectError)
  assert.equal(error.code, 'unauthorized')
  assert.equal(error.status, 401)
  const token = bearer(fake.calls[0])
  assert.ok(token.length > 20)
  assert.ok(!error.message.includes(token))
  assert.ok(!JSON.stringify(error).includes(token))
  assert.ok(!error.message.includes('PRIVATE KEY'))
  assert.equal(fake.calls.length, 1, 'a 401 is not retried')
})

test('ASC maps 422 to invalid with Apple detail', async () => {
  const { reorderScreenshots, AppStoreConnectError } = await ascModule
  const fake = fakeFetch(
    json({ errors: [{ detail: 'Screenshot ids do not match the set.' }] }, 422)
  )

  await assert.rejects(
    reorderScreenshots(ascCreds(), 'set1', ['a'], fake.options),
    (error) =>
      error instanceof AppStoreConnectError &&
      error.code === 'invalid' &&
      error.message.includes('Screenshot ids do not match the set.')
  )
  assert.equal(fake.calls[0].url, `${ASC}/appScreenshotSets/set1/relationships/appScreenshots`)
})

test('Google exchanges an RS256 assertion once and reuses the token', async () => {
  const { createEdit, listImages } = await playModule
  const creds = playCreds()
  const fake = fakeFetch(
    json({ access_token: 'ya29.token', expires_in: 3600, token_type: 'Bearer' }),
    json({ id: 'edit1', expiryTimeSeconds: '1792152000' }),
    json({ images: [] })
  )

  const edit = await createEdit(creds, 'com.example.app', fake.options)
  const images = await listImages(
    creds,
    'com.example.app',
    edit.id,
    'en-US',
    'phoneScreenshots',
    fake.options
  )

  assert.deepEqual(edit, { id: 'edit1', expiryTimeSeconds: 1792152000 })
  assert.deepEqual(images, [])
  assert.equal(fake.calls.filter((c) => c.url === 'https://oauth2.googleapis.com/token').length, 1)
  const [tokenCall, editCall, listCall] = fake.calls
  assert.equal(tokenCall.method, 'POST')
  assert.equal(tokenCall.headers.get('content-type'), 'application/x-www-form-urlencoded')
  const form = new URLSearchParams(bodyText(tokenCall))
  assert.equal(form.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer')
  const jwt = verifyRs256(form.get('assertion') ?? '', rsa.publicKey)
  assert.deepEqual(jwt.header, { alg: 'RS256', typ: 'JWT' })
  const iat = Math.floor(NOW / 1000)
  assert.deepEqual(jwt.payload, {
    iss: 'publisher@example.iam.gserviceaccount.com',
    scope: 'https://www.googleapis.com/auth/androidpublisher',
    aud: 'https://oauth2.googleapis.com/token',
    iat,
    exp: iat + 3600,
  })
  assert.equal(editCall.url, `${PLAY}/edits`)
  assert.equal(editCall.method, 'POST')
  assert.equal(listCall.url, `${PLAY}/edits/edit1/listings/en-US/phoneScreenshots`)
  for (const call of [editCall, listCall])
    assert.equal(call.headers.get('authorization'), 'Bearer ya29.token')
})

test('Google refuses a token_uri outside Google OAuth', async () => {
  const { createEdit, GooglePlayError } = await playModule
  const fake = fakeFetch()
  await assert.rejects(
    createEdit(
      { ...playCreds(), token_uri: 'http://169.254.169.254/token' },
      'com.example.app',
      fake.options
    ),
    GooglePlayError
  )
  assert.equal(fake.calls.length, 0)
})

test('Google upload skips an image whose SHA-256 is already in the listing', async () => {
  const { uploadImage } = await playModule
  const bytes = new Uint8Array([7, 7, 7])
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const existing = { id: 'img1', url: 'https://play.example/img1', sha1: 'x', sha256 }
  const fake = fakeFetch(
    json({ access_token: 't', expires_in: 3600 }),
    json({ images: [existing] })
  )

  const image = await uploadImage(
    playCreds(),
    'com.example.app',
    'edit1',
    'en-US',
    'phoneScreenshots',
    bytes,
    'image/png',
    fake.options
  )

  assert.deepEqual(image, existing)
  assert.equal(fake.calls.length, 2)
  assert.ok(!fake.calls.some((c) => c.url.startsWith(PLAY_UPLOAD)))
})

test('Google upload sends raw bytes with the image content type to the upload URL', async () => {
  const { uploadImage } = await playModule
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0x01])
  const uploaded = { id: 'img2', url: 'https://play.example/img2', sha1: 'a', sha256: 'b' }
  const fake = fakeFetch(
    json({ access_token: 't', expires_in: 3600 }),
    json({}),
    json({ image: uploaded })
  )

  const image = await uploadImage(
    playCreds(),
    'com.example.app',
    'edit1',
    'de-DE',
    'sevenInchScreenshots',
    bytes,
    'image/jpeg',
    fake.options
  )

  assert.deepEqual(image, uploaded)
  const upload = fake.calls[2]
  assert.equal(upload.method, 'POST')
  assert.equal(
    upload.url,
    `${PLAY_UPLOAD}/edits/edit1/listings/de-DE/sevenInchScreenshots?uploadType=media`
  )
  assert.equal(upload.headers.get('content-type'), 'image/jpeg')
  assert.equal(upload.headers.get('authorization'), 'Bearer t')
  assert.deepEqual(bodyBytes(upload), [0xff, 0xd8, 0xff, 0x01])
})

test('Google retries 5xx and maps 4xx with the Google message', async () => {
  const { deleteAllImages, GooglePlayError } = await playModule
  const fake = fakeFetch(
    json({ access_token: 't', expires_in: 3600 }),
    json({ error: { message: 'backend' } }, 503),
    json({ error: { code: 403, message: 'The caller does not have permission' } }, 403)
  )

  await assert.rejects(
    deleteAllImages(
      playCreds(),
      'com.example.app',
      'edit1',
      'en-US',
      'phoneScreenshots',
      fake.options
    ),
    (error) =>
      error instanceof GooglePlayError &&
      error.code === 'forbidden' &&
      error.message.includes('The caller does not have permission')
  )
  assert.deepEqual(fake.sleeps, [1000])
})

test('Google commits only when commitEdit is called explicitly', async () => {
  const { createEdit, uploadImage, validateEdit, commitEdit, deleteEdit } = await playModule
  const creds = playCreds()
  const edit = { id: 'edit1', expiryTimeSeconds: '1792152000' }
  const fake = fakeFetch(
    json({ access_token: 't', expires_in: 3600 }),
    json(edit),
    json({ images: [] }),
    json({ image: { id: 'img3', url: 'https://play.example/img3' } }),
    json(edit),
    new Response(null, { status: 204 })
  )

  await createEdit(creds, 'com.example.app', fake.options)
  await uploadImage(
    creds,
    'com.example.app',
    'edit1',
    'en-US',
    'phoneScreenshots',
    new Uint8Array([1]),
    'image/png',
    fake.options
  )
  await validateEdit(creds, 'com.example.app', 'edit1', fake.options)
  await deleteEdit(creds, 'com.example.app', 'edit1', fake.options)

  assert.ok(!fake.calls.some((c) => c.url.includes(':commit')), 'no commit without commitEdit')
  assert.equal(fake.calls[4].url, `${PLAY}/edits/edit1:validate`)
  assert.equal(fake.calls[5].method, 'DELETE')
  assert.equal(fake.calls[5].url, `${PLAY}/edits/edit1`)

  const commitFake = fakeFetch(json(edit))
  await commitEdit(creds, 'com.example.app', 'edit1', {
    ...commitFake.options,
    changesNotSentForReview: true,
  })
  assert.equal(commitFake.calls.length, 1, 'cached token, one commit request')
  assert.equal(commitFake.calls[0].method, 'POST')
  assert.equal(commitFake.calls[0].url, `${PLAY}/edits/edit1:commit?changesNotSentForReview=true`)
})
