import {
  unsubscribeOneClickContract,
  unsubscribePageContract,
} from '@/lib/api/contracts/unsubscribe'
import { errorResponse, route } from '@/lib/api/route'
import { publicAccess } from '@/lib/api/route-auth'
import { unsubscribeAudienceMember } from '@/lib/tenant/communications'
import { verifyUnsubscribeToken } from '@/lib/tenant/unsubscribe-token'

/**
 * One-click unsubscribe.
 *
 * Gmail and Yahoo require bulk senders to honor `List-Unsubscribe-Post`,
 * which sends an unauthenticated POST to this endpoint. The signed token
 * is the only authorization: it binds an address to an organization, so a
 * caller cannot edit the URL to unsubscribe someone else.
 *
 * GET serves the same action for recipients who click the footer link in
 * clients that do not implement one-click.
 */

async function processUnsubscribe(token: string | undefined): Promise<boolean> {
  const claim = token ? verifyUnsubscribeToken(token) : null
  if (!claim) return false

  await unsubscribeAudienceMember(claim)
  return true
}

/** RFC 8058 one-click unsubscribe from the `List-Unsubscribe-Post` header. */
export const POST = route(unsubscribeOneClickContract, {
  auth: publicAccess,
  // Mail providers retry on non-2xx, and an invalid token will never
  // become valid, so a bad token is reported without inviting retries.
  handler: async ({ query }) =>
    (await processUnsubscribe(query.token))
      ? undefined
      : errorResponse(400, 'Invalid unsubscribe token.'),
})

/** The footer link: unsubscribe, then answer with a small HTML page. */
export const GET = route(unsubscribePageContract, {
  auth: publicAccess,
  handler: async ({ query }) => {
    const accepted = await processUnsubscribe(query.token)
    const body = accepted
      ? 'You have been unsubscribed from product announcements.'
      : 'This unsubscribe link is not valid. It may have been altered in transit.'

    return new Response(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribe</title></head><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;padding:48px;max-width:32rem;margin:0 auto;color:#18181b"><h1 style="font-size:20px;margin:0 0 12px">Shots</h1><p style="font-size:15px;line-height:24px">${body}</p></body></html>`,
      { headers: { 'content-type': 'text/html; charset=utf-8' }, status: accepted ? 200 : 400 }
    )
  },
})
