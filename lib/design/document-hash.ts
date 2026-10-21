/** A hash of the exact document before asset references become temporary browser URLs. */
export async function resolvedDocumentHash(document: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(document))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
