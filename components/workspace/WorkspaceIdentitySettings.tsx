'use client'

import { type FormEvent, useCallback, useEffect, useState } from 'react'
import { z } from 'zod'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { WorkspaceSsoList } from './WorkspaceSsoList'
import { getErrorMessage, requestJson } from './settings-client'

const ssoProviderSchema = z.object({
  domain: z.string(),
  organizationId: z.string().nullable(),
  providerId: z.string(),
})
const ssoProvidersSchema = z.object({ providers: z.array(ssoProviderSchema) })
const scimProviderSchema = z.object({
  id: z.string(),
  organizationId: z.string().nullable(),
  providerId: z.string(),
})
const scimProvidersSchema = z.object({ providers: z.array(scimProviderSchema) })
const scimTokenSchema = z.object({ scimToken: z.string() })
const ssoInputSchema = z.object({
  clientId: z.string().trim().min(1),
  clientSecret: z.string().trim().min(1),
  domain: z.string().trim().min(3),
  issuer: z.string().url(),
  providerId: z
    .string()
    .trim()
    .regex(/^[a-z0-9_-]+$/),
})

type WorkspaceIdentitySettingsProps = {
  canManage: boolean
  isOwner: boolean
  organizationId: string
}
type ScimProvider = z.infer<typeof scimProviderSchema>
export type SsoProvider = z.infer<typeof ssoProviderSchema>

export function WorkspaceIdentitySettings({
  canManage,
  isOwner,
  organizationId,
}: WorkspaceIdentitySettingsProps) {
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  const [scimProviders, setScimProviders] = useState<ScimProvider[]>([])
  const [ssoProviders, setSsoProviders] = useState<SsoProvider[]>([])
  const [token, setToken] = useState<string | null>(null)

  const loadProviders = useCallback(async (): Promise<void> => {
    try {
      const [sso, scim] = await Promise.all([
        requestJson('/api/auth/sso/providers', ssoProvidersSchema),
        requestJson('/api/auth/scim/list-provider-connections', scimProvidersSchema),
      ])
      setSsoProviders(
        sso.providers.filter((provider) => provider.organizationId === organizationId)
      )
      setScimProviders(
        scim.providers.filter((provider) => provider.organizationId === organizationId)
      )
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    }
  }, [organizationId])

  useEffect(() => {
    void loadProviders()
  }, [loadProviders])

  async function registerSso(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setError(null)
    const form = event.currentTarget
    const input = ssoInputSchema.safeParse(Object.fromEntries(new FormData(form)))
    if (!input.success) {
      setError(input.error.issues[0]?.message ?? 'Check the provider details.')
      return
    }
    setPending('sso')
    try {
      await requestJson('/api/auth/sso/register', z.unknown(), {
        body: {
          ...input.data,
          oidcConfig: {
            clientId: input.data.clientId,
            clientSecret: input.data.clientSecret,
            pkce: true,
          },
          organizationId,
        },
        method: 'POST',
      })
      form.reset()
      await loadProviders()
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setPending(null)
    }
  }

  async function generateScimToken(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setError(null)
    const form = event.currentTarget
    const providerId = String(new FormData(form).get('providerId') ?? '')
    setPending('scim')
    try {
      const result = await requestJson('/api/auth/scim/generate-token', scimTokenSchema, {
        body: { organizationId, providerId },
        method: 'POST',
      })
      setToken(result.scimToken)
      form.reset()
      await loadProviders()
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setPending(null)
    }
  }

  async function removeScimProvider(provider: ScimProvider): Promise<void> {
    setError(null)
    setPending(provider.id)
    try {
      await requestJson('/api/auth/scim/delete-provider-connection', z.unknown(), {
        body: { providerId: provider.providerId },
        method: 'POST',
      })
      await loadProviders()
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setPending(null)
    }
  }

  if (!canManage)
    return (
      <p className="text-sm text-muted-foreground">
        SSO and SCIM configuration is available to workspace admins.
      </p>
    )
  return (
    <div className="grid max-w-3xl gap-8">
      <Alert>
        <AlertDescription>
          SSO and SCIM are enterprise features. Configuration requires a recent sign-in and
          two-factor authentication.
        </AlertDescription>
      </Alert>
      {token ? <ScimTokenNotice onDismiss={() => setToken(null)} token={token} /> : null}
      <SsoForm isSubmitting={pending === 'sso'} onSubmit={registerSso} />
      <WorkspaceSsoList providers={ssoProviders} />
      {isOwner ? <ScimForm isSubmitting={pending === 'scim'} onSubmit={generateScimToken} /> : null}
      <ScimList isDeleting={pending} onDelete={removeScimProvider} providers={scimProviders} />
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  )
}

function SsoForm({
  isSubmitting,
  onSubmit,
}: {
  isSubmitting: boolean
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>
}) {
  return (
    <form className="grid gap-4" onSubmit={onSubmit}>
      <div>
        <h3 className="text-sm font-semibold">OpenID Connect SSO</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Connect Okta, Microsoft Entra ID, or another OIDC identity provider.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input name="providerId" placeholder="acme-okta" required />
        <Input name="domain" placeholder="company.com" required />
        <Input name="issuer" placeholder="https://company.okta.com" required type="url" />
        <Input name="clientId" placeholder="Client ID" required />
        <Input
          className="sm:col-span-2"
          name="clientSecret"
          placeholder="Client secret"
          required
          type="password"
        />
      </div>
      <Button className="w-fit" disabled={isSubmitting} type="submit">
        {isSubmitting ? 'Connecting…' : 'Connect SSO provider'}
      </Button>
    </form>
  )
}

function ScimForm({
  isSubmitting,
  onSubmit,
}: {
  isSubmitting: boolean
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>
}) {
  return (
    <form className="grid gap-4 border-t border-foreground/10 pt-8" onSubmit={onSubmit}>
      <div>
        <h3 className="text-sm font-semibold">SCIM directory sync</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Create a provisioning token for your directory provider.
        </p>
      </div>
      <div className="flex gap-3">
        <Input className="flex-1" name="providerId" placeholder="acme-scim" required />
        <Button disabled={isSubmitting} type="submit">
          {isSubmitting ? 'Generating…' : 'Generate token'}
        </Button>
      </div>
    </form>
  )
}

function ScimTokenNotice({ onDismiss, token }: { onDismiss: () => void; token: string }) {
  return (
    <div className="grid gap-3 rounded-md border border-primary/30 bg-primary/10 p-4">
      <p className="text-sm font-semibold">Copy this SCIM token now. It cannot be shown again.</p>
      <code className="overflow-x-auto rounded bg-background p-3 text-xs">{token}</code>
      <Button className="w-fit" onClick={onDismiss} size="sm" type="button">
        Done
      </Button>
    </div>
  )
}

function ScimList({
  isDeleting,
  onDelete,
  providers,
}: {
  isDeleting: string | null
  onDelete: (provider: ScimProvider) => Promise<void>
  providers: ScimProvider[]
}) {
  return (
    <section className="grid gap-3">
      <h3 className="text-sm font-semibold">SCIM connections</h3>
      {providers.length === 0 ? (
        <p className="text-sm text-muted-foreground">No directory connections are configured.</p>
      ) : (
        <ul className="overflow-hidden rounded-md border border-foreground/10">
          {providers.map((provider) => (
            <li
              className="flex items-center justify-between gap-3 border-b border-foreground/10 px-4 py-3 text-sm last:border-b-0"
              key={provider.id}
            >
              <span>{provider.providerId}</span>
              <Button
                disabled={isDeleting === provider.id}
                onClick={() => void onDelete(provider)}
                size="sm"
                type="button"
                variant="ghost"
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
