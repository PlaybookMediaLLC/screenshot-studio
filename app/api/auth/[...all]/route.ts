import { toNextJsHandler } from 'better-auth/next-js'
import { AuthorizationError } from '@/lib/auth/access'
import { assertAuthEnvironment } from '@/lib/auth/environment'
import {
  authorizeEnterpriseAuthRequest,
  logEnterpriseAuthRequest,
} from '@/lib/auth/enterprise-guard'
import { auth } from '@/lib/auth/server'

const handler = toNextJsHandler({
  handler: async (request: Request): Promise<Response> => {
    try {
      assertAuthEnvironment()
      const enterpriseRequest = await authorizeEnterpriseAuthRequest(request)
      const response = await auth.handler(request)
      if (enterpriseRequest && response.ok) {
        try {
          await logEnterpriseAuthRequest(request, enterpriseRequest)
        } catch (error) {
          console.error('Enterprise identity audit write failed.', error)
        }
      }
      return response
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return Response.json({ error: error.message }, { status: error.status })
      }

      throw error
    }
  },
})

export const { DELETE, GET, PATCH, POST, PUT } = handler
