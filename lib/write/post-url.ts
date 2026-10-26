import type { DraftChannel } from './document'

/** Recognize a native target without fetching the supplied URL or changing pasted text. */
export function nativePostURL(text: string): { url: string; channel: DraftChannel } | null {
  const value = text.trim()
  if (value.length > 2048 || /\s/.test(value)) return null
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null
  if (
    /^(?:www\.|mobile\.)?(?:x|twitter)\.com$/.test(url.hostname) &&
    /^\/(?:[A-Za-z0-9_]{1,15}|i(?:\/web)?)\/status\/[0-9]{1,30}\/?$/.test(url.pathname)
  )
    return { url: value, channel: 'x' }
  if (/^(?:www\.)?linkedin\.com$/.test(url.hostname)) {
    let path: string
    try {
      path = decodeURIComponent(url.pathname)
    } catch {
      return null
    }
    if (/urn:li:(?:share|ugcPost|activity):[0-9]{1,30}/.test(path))
      return { url: value, channel: 'linkedin' }
  }
  if (/^https:\/\/bsky\.app\/profile\/[A-Za-z0-9.:-]{1,253}\/post\/[A-Za-z0-9]{1,64}$/.test(value))
    return { url: value, channel: 'bluesky' }
  if (
    /^https:\/\/[A-Za-z0-9][A-Za-z0-9.-]{0,252}\/(?:@[A-Za-z0-9_.-]+\/[0-9]{1,80}|users\/[A-Za-z0-9_.-]+\/statuses\/[0-9]{1,80})$/.test(
      value
    )
  )
    return { url: value, channel: 'mastodon' }
  return null
}
