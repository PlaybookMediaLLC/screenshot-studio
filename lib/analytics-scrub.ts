/**
 * Removes capability tokens from URLs before analytics leave the browser.
 * Share links (/s/<token>), review links (/review/<token>), invitations and
 * reset links carry secrets in their path or query.
 */

const TOKEN_PATH = /\/(s|review)\/[^/?#]+/g
const SECRET_PARAMS = ['token', 'invitationId', 'callbackURL']

/** Returns the string with share/review tokens and secret query values redacted. */
export function scrubUrl(value: string): string {
  let scrubbed = value.replace(TOKEN_PATH, '/$1/[redacted]')
  for (const param of SECRET_PARAMS) {
    scrubbed = scrubbed.replace(new RegExp(`([?&]${param}=)[^&#]*`, 'g'), '$1[redacted]')
  }
  return scrubbed
}

/** Scrubs every string property of an analytics event in place and returns it. */
export function scrubEvent<T extends { properties?: Record<string, unknown>; $set?: Record<string, unknown> } | null>(
  event: T,
): T {
  for (const bag of [event?.properties, event?.$set]) {
    if (!bag) continue
    for (const [key, value] of Object.entries(bag)) {
      if (typeof value === 'string') bag[key] = scrubUrl(value)
    }
  }
  return event
}
