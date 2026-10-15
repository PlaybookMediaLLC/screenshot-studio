import { z } from 'zod'
import { defineContract } from '@/lib/api/contract'

/** The signed unsubscribe token from the email footer or `List-Unsubscribe` URL. */
export const unsubscribeQuerySchema = z.object({ token: z.string().optional() })

/** `POST /api/unsubscribe`: RFC 8058 one-click unsubscribe. */
export const unsubscribeOneClickContract = defineContract({
  method: 'POST',
  name: 'unsubscribe.one-click',
  output: z.undefined(),
  path: '/api/unsubscribe',
  query: unsubscribeQuerySchema,
  status: 204,
  summary: 'Unsubscribe with one click',
})

/** `GET /api/unsubscribe`: the footer link; answers with an HTML page. */
export const unsubscribePageContract = defineContract({
  method: 'GET',
  name: 'unsubscribe.page',
  output: z.undefined(),
  path: '/api/unsubscribe',
  query: unsubscribeQuerySchema,
  summary: 'Unsubscribe from the footer link',
})
