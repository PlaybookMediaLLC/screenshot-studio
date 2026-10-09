import { lookup } from 'node:dns/promises'
import http from 'node:http'
import https from 'node:https'
import { isIP } from 'node:net'

/**
 * Fetch a release source link without letting the link reach anything private.
 *
 * Every hop is checked before it is requested: http(s) only, no credentials in
 * the URL, default web ports, and every address the hostname resolves to must
 * be public. The connection then uses the address that was checked (the DNS
 * lookup is pinned), so a name cannot resolve to a public address for the
 * check and a private one for the request. Redirects are followed by hand and
 * checked again. Responses are capped in size and time and must be text.
 */

const DEFAULT_MAX_BYTES = 1_500_000
const DEFAULT_TIMEOUT_MS = 10_000
const MAX_REDIRECTS = 4
const WEB_PORTS = new Set(['', '80', '443', '8080', '8443'])
const TEXT_TYPES = [
  'text/html',
  'text/plain',
  'text/markdown',
  'text/x-markdown',
  'application/json',
  'application/xhtml+xml',
  'application/vnd.github+json',
]

function ipv4Parts(address: string): number[] {
  return address.split('.').map((part) => Number(part))
}

/** Whether an IP address is publicly routable (not loopback, private, link-local, CGNAT, multicast, reserved). */
export function isPublicAddress(address: string): boolean {
  const kind = isIP(address)
  if (kind === 4) {
    const [a = 0, b = 0, c = 0] = ipv4Parts(address)
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false
    if (a === 100 && b >= 64 && b <= 127) return false // carrier-grade NAT
    if (a === 169 && b === 254) return false // link-local, cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return false
    if (a === 192 && b === 168) return false
    if (a === 192 && b === 0 && (c === 0 || c === 2)) return false
    if (a === 198 && (b === 18 || b === 19)) return false // benchmarking
    if (a === 198 && b === 51 && c === 100) return false
    if (a === 203 && b === 0 && c === 113) return false
    return true
  }
  if (kind === 6) {
    const value = address.toLowerCase()
    const mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    if (mapped) return isPublicAddress(mapped[1]!)
    if (value === '::' || value === '::1') return false
    if (/^(fc|fd)/.test(value)) return false // unique local
    if (/^fe[89ab]/.test(value)) return false // link-local
    if (value.startsWith('ff')) return false // multicast
    if (value.startsWith('2001:db8')) return false // documentation
    if (value.startsWith('64:ff9b:')) return false // NAT64 can reach IPv4 private space
    return true
  }
  return false
}

export type Resolver = (hostname: string) => Promise<Array<{ address: string; family: number }>>

export type TransportResponse = {
  body: AsyncIterable<Buffer | string>
  destroy: () => void
  headers: Record<string, string | string[] | undefined>
  status: number
}

export type Transport = (request: {
  address: string
  family: number
  headers: Record<string, string>
  timeoutMs: number
  url: URL
}) => Promise<TransportResponse>

export type SafeFetchOptions = {
  /** Extra request headers (for example an Accept header for an API). */
  headers?: Record<string, string>
  /**
   * Hosts allowed even though they resolve privately. Only for test
   * infrastructure (the e2e mock), read from SCREENSHOT_E2E_ALLOWED_DOWNLOAD_HOSTS.
   */
  allowedPrivateHosts?: ReadonlySet<string>
  maxBytes?: number
  resolve?: Resolver
  timeoutMs?: number
  transport?: Transport
}

export type FetchedText =
  | { body: string; contentType: string; ok: true; truncated: boolean; url: string }
  | { ok: false; reason: string; status: 'blocked' | 'failed' }

const defaultResolver: Resolver = async (hostname) =>
  lookup(hostname, { all: true, verbatim: true })

const nodeTransport: Transport = ({ address, family, headers, timeoutMs, url }) =>
  new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http
    const request = client.request(
      url,
      {
        headers,
        // Connect to the address that was checked, whatever DNS says now.
        lookup: (_hostname, options, callback) => {
          const done = callback as (
            error: Error | null,
            address: string | Array<{ address: string; family: number }>,
            family?: number
          ) => void
          if ((options as { all?: boolean }).all) done(null, [{ address, family }])
          else done(null, address, family)
        },
        method: 'GET',
        timeout: timeoutMs,
      },
      (response) =>
        resolve({
          body: response,
          destroy: () => response.destroy(),
          headers: response.headers,
          status: response.statusCode ?? 0,
        })
    )
    request.on('timeout', () => request.destroy(new Error('The source took too long to respond.')))
    request.on('error', reject)
    request.end()
  })

function header(headers: TransportResponse['headers'], name: string): string {
  const value = headers[name]
  return (Array.isArray(value) ? value[0] : value) ?? ''
}

export function allowedTestHosts(): Set<string> {
  return new Set(
    (process.env.SCREENSHOT_E2E_ALLOWED_DOWNLOAD_HOSTS ?? '')
      .split(',')
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean)
  )
}

async function checkHop(
  url: URL,
  options: SafeFetchOptions
): Promise<{ address: string; family: number } | { reason: string }> {
  if (!['http:', 'https:'].includes(url.protocol))
    return { reason: 'Only http and https links are read.' }
  if (url.username || url.password) return { reason: 'Links with credentials are not read.' }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  const testHost = options.allowedPrivateHosts?.has(hostname) ?? false
  if (!testHost && !WEB_PORTS.has(url.port)) return { reason: 'Only standard web ports are read.' }
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    if (!testHost) return { reason: 'Local addresses are not read.' }
  }
  let addresses: Array<{ address: string; family: number }>
  if (isIP(hostname)) {
    addresses = [{ address: hostname, family: isIP(hostname) }]
  } else {
    try {
      addresses = await (options.resolve ?? defaultResolver)(hostname)
    } catch {
      return { reason: 'The host could not be resolved.' }
    }
  }
  if (addresses.length === 0) return { reason: 'The host could not be resolved.' }
  if (!testHost && addresses.some((entry) => !isPublicAddress(entry.address))) {
    return { reason: 'The link points at a private network address.' }
  }
  return addresses[0]!
}

export async function safeFetchText(
  input: string,
  options: SafeFetchOptions = {}
): Promise<FetchedText> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const transport = options.transport ?? nodeTransport
  let url: URL
  try {
    url = new URL(input)
  } catch {
    return { ok: false, reason: 'The link is not a valid URL.', status: 'blocked' }
  }
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const checked = await checkHop(url, options)
    if ('reason' in checked) return { ok: false, reason: checked.reason, status: 'blocked' }
    let response: TransportResponse
    try {
      response = await transport({
        address: checked.address,
        family: checked.family,
        headers: {
          accept: 'text/html,text/plain,text/markdown,application/json;q=0.9,*/*;q=0.1',
          'user-agent': 'ScreenshotStudioLaunchBot/1.0 (+release spec drafting)',
          ...options.headers,
        },
        timeoutMs,
        url,
      })
    } catch (error) {
      return {
        ok: false,
        reason:
          error instanceof Error ? error.message.slice(0, 200) : 'The source could not be read.',
        status: 'failed',
      }
    }
    if (response.status >= 300 && response.status < 400) {
      const location = header(response.headers, 'location')
      response.destroy()
      if (!location)
        return { ok: false, reason: 'A redirect had no destination.', status: 'failed' }
      try {
        url = new URL(location, url)
      } catch {
        return { ok: false, reason: 'A redirect pointed at an invalid URL.', status: 'blocked' }
      }
      continue
    }
    if (response.status >= 400 || response.status === 0) {
      response.destroy()
      return { ok: false, reason: `The source returned HTTP ${response.status}.`, status: 'failed' }
    }
    const contentType = header(response.headers, 'content-type').split(';')[0]!.trim().toLowerCase()
    if (contentType && !TEXT_TYPES.includes(contentType)) {
      response.destroy()
      return { ok: false, reason: `The source is ${contentType}, not text.`, status: 'failed' }
    }
    const chunks: Buffer[] = []
    let size = 0
    let truncated = false
    try {
      for await (const chunk of response.body) {
        const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
        if (size + buffer.length > maxBytes) {
          chunks.push(buffer.subarray(0, maxBytes - size))
          truncated = true
          response.destroy()
          break
        }
        chunks.push(buffer)
        size += buffer.length
      }
    } catch (error) {
      if (!truncated) {
        return {
          ok: false,
          reason:
            error instanceof Error ? error.message.slice(0, 200) : 'The source could not be read.',
          status: 'failed',
        }
      }
    }
    return {
      body: Buffer.concat(chunks).toString('utf8'),
      contentType: contentType || 'text/html',
      ok: true,
      truncated,
      url: url.toString(),
    }
  }
  return { ok: false, reason: 'The link redirected too many times.', status: 'failed' }
}
