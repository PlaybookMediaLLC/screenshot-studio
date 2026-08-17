'use client'

import { type FormEvent, useEffect, useState } from 'react'
import { z } from 'zod'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { apiKeyScopes } from '@/lib/auth/api-key-scopes'
import { getErrorMessage, requestJson } from './settings-client'

const apiKeySchema = z.object({
  createdAt: z.string(),
  enabled: z.boolean().nullable(),
  expiresAt: z.string().nullable(),
  id: z.string(),
  name: z.string().nullable(),
  prefix: z.string().nullable(),
  start: z.string().nullable(),
})
const apiKeysSchema = z.object({ keys: z.array(apiKeySchema) })
const apiKeyCreateSchema = z.object({ apiKey: apiKeySchema.extend({ key: z.string() }) })
const sourceSchema = z.object({
  allowedHost: z.string().url(),
  name: z.string().trim().min(2).max(100),
  provider: z.enum(['generic', 'github', 'gitlab']),
})

type WorkspaceDeveloperSettingsProps = { canManage: boolean }
type ApiKey = z.infer<typeof apiKeySchema>

export function WorkspaceDeveloperSettings({ canManage }: WorkspaceDeveloperSettingsProps) {
  const [error, setError] = useState<string | null>(null)
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [newKey, setNewKey] = useState<string | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)

  async function loadKeys(): Promise<void> {
    try {
      const result = await requestJson('/api/tenant/api-keys', apiKeysSchema)
      setKeys(result.keys)
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    }
  }

  useEffect(() => {
    void loadKeys()
  }, [])

  async function createKey(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setError(null)
    const form = event.currentTarget
    const data = new FormData(form)
    const scopes = data.getAll('scopes').map(String)
    setPendingId('create-key')
    try {
      const result = await requestJson('/api/tenant/api-keys', apiKeyCreateSchema, {
        body: {
          expiresInDays: data.get('expiresInDays') || undefined,
          name: data.get('name'),
          scopes,
        },
        method: 'POST',
      })
      setNewKey(result.apiKey.key)
      form.reset()
      await loadKeys()
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setPendingId(null)
    }
  }

  async function revokeKey(keyId: string): Promise<void> {
    setError(null)
    setPendingId(keyId)
    try {
      await requestJson('/api/tenant/api-keys', z.object({ success: z.literal(true) }), {
        body: { keyId },
        method: 'DELETE',
      })
      await loadKeys()
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setPendingId(null)
    }
  }

  async function createSource(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setError(null)
    const form = event.currentTarget
    const input = sourceSchema.safeParse(Object.fromEntries(new FormData(form)))
    if (!input.success) {
      setError(input.error.issues[0]?.message ?? 'Check the source values.')
      return
    }
    setPendingId('create-source')
    try {
      await requestJson('/api/tenant/source-apps', z.unknown(), {
        body: {
          allowedHosts: [input.data.allowedHost],
          name: input.data.name,
          provider: input.data.provider,
        },
        method: 'POST',
      })
      form.reset()
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setPendingId(null)
    }
  }

  return (
    <div className="grid max-w-3xl gap-8">
      {newKey ? <NewKeyNotice apiKey={newKey} onDismiss={() => setNewKey(null)} /> : null}
      <section className="grid gap-4">
        <div>
          <h3 className="text-sm font-semibold">Organization API keys</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Keys are shown once. Revoke a key when it is no longer needed.
          </p>
        </div>
        {canManage ? (
          <ApiKeyForm isSubmitting={pendingId === 'create-key'} onSubmit={createKey} />
        ) : null}
        <ApiKeyList canManage={canManage} isRevoking={pendingId} keys={keys} onRevoke={revokeKey} />
      </section>
      {canManage ? (
        <SourceForm isSubmitting={pendingId === 'create-source'} onSubmit={createSource} />
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  )
}

function NewKeyNotice({ apiKey, onDismiss }: { apiKey: string; onDismiss: () => void }) {
  async function copyKey(): Promise<void> {
    await navigator.clipboard.writeText(apiKey)
  }

  return (
    <div className="grid gap-3 rounded-md border border-primary/30 bg-primary/10 p-4">
      <p className="text-sm font-semibold">Copy this API key now. It cannot be shown again.</p>
      <code className="overflow-x-auto rounded bg-background p-3 text-xs">{apiKey}</code>
      <div className="flex gap-2">
        <Button onClick={() => void copyKey()} size="sm" type="button">
          Copy key
        </Button>
        <Button onClick={onDismiss} size="sm" type="button" variant="ghost">
          Done
        </Button>
      </div>
    </div>
  )
}

function ApiKeyForm({
  isSubmitting,
  onSubmit,
}: {
  isSubmitting: boolean
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>
}) {
  return (
    <form
      className="grid gap-4 rounded-md border border-foreground/10 bg-background p-4"
      onSubmit={onSubmit}
    >
      <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
        <Input name="name" placeholder="Production deploys" required />
        <Input min="1" name="expiresInDays" placeholder="Expires in days" type="number" />
      </div>
      <fieldset className="grid gap-2">
        <legend className="text-sm font-medium">Scopes</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {apiKeyScopes.map((scope) => (
            <div className="flex items-center gap-2" key={scope}>
              <Checkbox defaultChecked id={`scope-${scope}`} name="scopes" value={scope} />
              <Label htmlFor={`scope-${scope}`}>{scope}</Label>
            </div>
          ))}
        </div>
      </fieldset>
      <Button className="w-fit" disabled={isSubmitting} type="submit">
        {isSubmitting ? 'Creating…' : 'Create API key'}
      </Button>
    </form>
  )
}

function ApiKeyList({
  canManage,
  isRevoking,
  keys,
  onRevoke,
}: {
  canManage: boolean
  isRevoking: string | null
  keys: ApiKey[]
  onRevoke: (keyId: string) => Promise<void>
}) {
  if (keys.length === 0)
    return <p className="text-sm text-muted-foreground">No API keys have been created.</p>
  return (
    <ul className="overflow-hidden rounded-md border border-foreground/10">
      {keys.map((key) => (
        <li
          className="flex items-center justify-between gap-3 border-b border-foreground/10 px-4 py-3 text-sm last:border-b-0"
          key={key.id}
        >
          <div>
            <p className="font-medium">{key.name ?? 'Untitled key'}</p>
            <p className="text-xs text-muted-foreground">
              {key.start ?? key.prefix ?? 'Hidden key'} · {key.enabled ? 'active' : 'disabled'}
            </p>
          </div>
          {canManage ? (
            <Button
              disabled={isRevoking === key.id}
              onClick={() => void onRevoke(key.id)}
              size="sm"
              type="button"
              variant="ghost"
            >
              Revoke
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  )
}

function SourceForm({
  isSubmitting,
  onSubmit,
}: {
  isSubmitting: boolean
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>
}) {
  return (
    <form className="grid gap-4 border-t border-foreground/10 pt-8" onSubmit={onSubmit}>
      <div>
        <h3 className="text-sm font-semibold">Inbound release source</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Allow a Git provider or release tool to send content to this workspace.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Input name="name" placeholder="GitHub production" required />
        <Select defaultValue="github" name="provider">
          <SelectTrigger className="h-10 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="github">GitHub</SelectItem>
            <SelectItem value="gitlab">GitLab</SelectItem>
            <SelectItem value="generic">Generic webhook</SelectItem>
          </SelectContent>
        </Select>
        <Input name="allowedHost" placeholder="https://api.github.com" required type="url" />
      </div>
      <Button className="w-fit" disabled={isSubmitting} type="submit">
        {isSubmitting ? 'Adding…' : 'Add source'}
      </Button>
    </form>
  )
}
