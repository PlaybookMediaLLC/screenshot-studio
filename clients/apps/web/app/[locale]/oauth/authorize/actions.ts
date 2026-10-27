'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { requireActiveOrganizationPermission } from '@/lib/auth/access'
import {
  agentConsentFormSchema,
  approveAgentAuthorization,
  oauthRedirect,
  previewAgentAuthorization,
} from '@/lib/tenant/agent-access'

function readForm(formData: FormData) {
  const fields = Object.fromEntries(
    [...formData.entries()].filter(([key, value]) => key !== 'scopes' && value !== '')
  )
  return agentConsentFormSchema.parse({ ...fields, scopes: formData.getAll('scopes') })
}

/** Approve: the backend issues the code, then the browser returns to the agent. */
export async function approveAgentConnection(formData: FormData): Promise<void> {
  const form = readForm(formData)
  const access = await requireActiveOrganizationPermission(await headers(), 'brand:manage')
  const { code, redirectUri } = await approveAgentAuthorization(access, form)
  redirect(oauthRedirect(redirectUri, { code, state: form.state }))
}

/** Deny: only a redirect the backend validated receives the refusal. */
export async function denyAgentConnection(formData: FormData): Promise<void> {
  const form = readForm(formData)
  const access = await requireActiveOrganizationPermission(await headers(), 'brand:manage')
  const consent = await previewAgentAuthorization(access, form)
  redirect(oauthRedirect(consent.redirectUri, { error: 'access_denied', state: form.state }))
}
