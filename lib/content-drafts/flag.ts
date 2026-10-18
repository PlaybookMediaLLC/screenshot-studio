/**
 * Content drafts ship behind a flag (RFC 037), like the campaign workflow's
 * `PLATFORM_CAMPAIGN_WORKFLOW`. Off, the drafts pages and API routes answer
 * 404. The plan gate (`content:drafts`) still applies when it is on.
 */
export function contentDraftsEnabled(): boolean {
  return process.env.PLATFORM_CONTENT_DRAFTS === 'enabled'
}
