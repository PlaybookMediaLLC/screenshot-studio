/** Read the native post identity from LinkedIn's feed and public share URLs. */
export function linkedInPostIdentity(value: string): string | null {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || !['linkedin.com', 'www.linkedin.com'].includes(url.host))
      return null
    const path = decodeURIComponent(url.pathname)
    const feed = path.match(/^\/feed\/update\/(urn:li:(?:share|ugcPost|activity):[0-9]{1,30})\/?$/)
    if (feed) return feed[1]
    const share = path.match(
      /^\/posts\/[A-Za-z0-9_-]+-activity-([0-9]{1,30})(?:-[A-Za-z0-9_-]+)?\/?$/
    )
    return share ? `urn:li:activity:${share[1]}` : null
  } catch {
    return null
  }
}
