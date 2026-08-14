import { createHash } from 'crypto'
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { prisma } from './db'
import { getR2PublicUrl } from './r2'

const CACHE_MAX_AGE_MS = 2 * 24 * 60 * 60 * 1000
const CACHE_VARIANTS = ['desktop:light', 'desktop:dark', 'mobile:light', 'mobile:dark']
const R2_BUCKET = process.env.R2_BUCKET_NAME || 'stage-assets'
const SCREENSHOT_CACHE_CONTROL = 'public, max-age=172800, s-maxage=172800'
const r2Endpoint = process.env.R2_ENDPOINT || `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`

const r2Client = new S3Client({
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
  },
  endpoint: r2Endpoint,
  forcePathStyle: process.env.R2_FORCE_PATH_STYLE === 'true',
  region: process.env.R2_REGION || 'auto',
})

type CacheObject = {
  key: string
  url: string
}

function getCacheVariants(url: string): string[] {
  const normalizedUrl = normalizeUrl(url)
  return CACHE_VARIANTS.map((variant) => normalizeUrl(`${normalizedUrl}:${variant}`))
}

async function readPrivateObject(key: string): Promise<string | null> {
  const response = await r2Client.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }))
  const bytes = await response.Body?.transformToByteArray()
  return bytes ? Buffer.from(bytes).toString('base64') : null
}

async function uploadToR2(screenshotBase64: string, hash: string): Promise<CacheObject> {
  const key = `screenshots/${hash}.png`
  await r2Client.send(new PutObjectCommand({
    Body: Buffer.from(screenshotBase64, 'base64'),
    Bucket: R2_BUCKET,
    CacheControl: SCREENSHOT_CACHE_CONTROL,
    ContentType: 'image/png',
    Key: key,
  }))

  return { key, url: getR2PublicUrl(key) }
}

async function deleteFromR2(keys: string[]): Promise<void> {
  if (!keys.length) {
    return
  }

  await r2Client.send(new DeleteObjectsCommand({
    Bucket: R2_BUCKET,
    Delete: { Objects: keys.map((key) => ({ Key: key })) },
  }))
}

async function getRemoteScreenshot(key: string, url: string): Promise<string | null> {
  if (process.env.R2_ENDPOINT) {
    return readPrivateObject(key)
  }

  const response = await fetch(url)
  if (!response.ok) {
    return null
  }

  return Buffer.from(await response.arrayBuffer()).toString('base64')
}

async function deleteCacheRecord(hash: string): Promise<void> {
  await prisma.screenshotCache.delete({ where: { urlHash: hash } }).catch(() => undefined)
}

export function normalizeUrl(urlString: string): string {
  try {
    const url = new URL(urlString)
    url.protocol = url.protocol.toLowerCase()
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, '')

    if (url.port === '80' && url.protocol === 'http:') {
      url.port = ''
    }
    if (url.port === '443' && url.protocol === 'https:') {
      url.port = ''
    }
    if (url.pathname !== '/' && url.pathname.endsWith('/')) {
      url.pathname = url.pathname.slice(0, -1)
    }

    url.hash = ''
    const sorted = [...url.searchParams.entries()].sort(([left], [right]) => left.localeCompare(right))
    url.search = sorted.length ? `?${new URLSearchParams(sorted)}` : ''
    return url.toString()
  } catch {
    return urlString
  }
}

export function hashUrl(url: string): string {
  return createHash('sha256').update(normalizeUrl(url)).digest('hex')
}

export async function getCachedScreenshot(
  url: string,
  maxAgeMs: number = CACHE_MAX_AGE_MS
): Promise<string | null> {
  try {
    const hash = hashUrl(url)
    const cached = await prisma.screenshotCache.findUnique({ where: { urlHash: hash } })
    if (!cached) {
      return null
    }
    if (Date.now() - cached.createdAt.getTime() > maxAgeMs) {
      await invalidateCache(url)
      return null
    }

    const screenshot = await getRemoteScreenshot(cached.cloudinaryPublicId, cached.cloudinaryUrl)
    if (screenshot) {
      return screenshot
    }
    await deleteCacheRecord(hash)
    return null
  } catch (error) {
    console.error('Error reading cached screenshot:', error)
    return null
  }
}

export async function cacheScreenshot(url: string, screenshotBase64: string): Promise<void> {
  const hash = hashUrl(url)
  const object = await uploadToR2(screenshotBase64, hash)
  const normalizedUrl = normalizeUrl(url)

  await prisma.screenshotCache.upsert({
    create: {
      cloudinaryPublicId: object.key,
      cloudinaryUrl: object.url,
      url: normalizedUrl,
      urlHash: hash,
    },
    update: {
      cloudinaryPublicId: object.key,
      cloudinaryUrl: object.url,
      url: normalizedUrl,
    },
    where: { urlHash: hash },
  })
}

export async function invalidateCache(url: string): Promise<void> {
  const cacheUrls = getCacheVariants(url)
  const entries = await prisma.screenshotCache.findMany({
    select: { cloudinaryPublicId: true },
    where: { url: { in: cacheUrls } },
  })
  if (!entries.length) {
    return
  }

  await deleteFromR2(entries.map((entry) => entry.cloudinaryPublicId))
  await prisma.screenshotCache.deleteMany({ where: { url: { in: cacheUrls } } })
}

export async function invalidateCacheBatch(urls: string[]): Promise<void> {
  await Promise.all(urls.map((url) => invalidateCache(url)))
}

export async function clearOldCache(maxAgeMs: number = CACHE_MAX_AGE_MS): Promise<void> {
  const cutoff = new Date(Date.now() - maxAgeMs)
  const entries = await prisma.screenshotCache.findMany({
    select: { cloudinaryPublicId: true },
    where: { createdAt: { lt: cutoff } },
  })
  if (!entries.length) {
    return
  }

  await deleteFromR2(entries.map((entry) => entry.cloudinaryPublicId))
  await prisma.screenshotCache.deleteMany({ where: { createdAt: { lt: cutoff } } })
}
