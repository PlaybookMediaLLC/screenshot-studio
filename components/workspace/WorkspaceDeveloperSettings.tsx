'use client'

import { type FormEvent, useCallback, useEffect, useState } from 'react'
import { z } from 'zod'
import { Group, Pill, Row, Section } from '@/components/platform-ui'
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
import { apiKeyScopes, type ApiKeyScope } from '@/lib/auth/api-key-scopes'
import { useTRPCClient } from '@/lib/trpc/react'
import { getErrorMessage } from './settings-client'

const sourceSchema = z.object({
  allowedHost: z.string().url(),
  name: z.string().trim().min(2).max(100),
  provider: z.enum(['generic', 'github', 'gitlab']),
})

type WorkspaceDeveloperSettingsProps = { canManage: boolean }
type ApiKey = {
  createdAt: Date | string
  enabled: boolean | null
  expiresAt: Date | string | null
  id: string
  name: string | null
  prefix: string | null
  start: string | null
}

export function WorkspaceDeveloperSettings({ canManage }: WorkspaceDeveloperSettingsProps) {
  const trpcClient = useTRPCClient()
  const [error, setError] = useState<string | null>(null)
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [newKey, setNewKey] = useState<string | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)

  const loadKeys = useCallback(async (): Promise<void> => {
    try {
      const result = await trpcClient.apiKey.list.query()
      setKeys(result.keys)
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    }
  }, [trpcClient])

  useEffect(() => {
    void loadKeys()
  }, [loadKeys])

  async function createKey(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setError(null)
    const form = event.currentTarget
    const data = new FormData(form)
    const scopes = data.getAll('scopes').map(String) as ApiKeyScope[]
    setPendingId('create-key')
    try {
      const expiresInDays = data.get('expiresInDays')
      const result = await trpcClient.apiKey.create.mutate({
        expiresInDays: expiresInDays ? Number(expiresInDays) : undefined,
        name: String(data.get('name') ?? ''),
        scopes,
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
      await trpcClient.apiKey.revoke.mutate({ keyId })
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
      await trpcClient.sourceApp.create.mutate({
        allowedHosts: [input.data.allowedHost],
        name: input.data.name,
        provider: input.data.provider,
      })
      form.reset()
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setPendingId(null)
    }
  }

  return (
    <div className="flex flex-col gap-10">
      {newKey ? <NewKeyNotice apiKey={newKey} onDismiss={() => setNewKey(null)} /> : null}
      <Section
        description="Keys are shown once. Revoke a key when it is no longer needed."
        title="Organization API keys"
      >
        <Group>
          <ApiKeyList
            canManage={canManage}
            isRevoking={pendingId}
            keys={keys}
            onRevoke={revokeKey}
          />
          {canManage ? (
            <Row>
              <ApiKeyForm isSubmitting={pendingId === 'create-key'} onSubmit={createKey} />
            </Row>
          ) : null}
        </Group>
      </Section>
      {canManage ? (
        <Section
          description="Allow a Git provider or release tool to send content to this workspace."
          title="Inbound release source"
        >
          <Group>
            <Row>
              <SourceForm isSubmitting={pendingId === 'create-source'} onSubmit={createSource} />
            </Row>
          </Group>
        </Section>
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  )
}

const fieldLabel = 'text-xs font-medium text-neutral-400'

function NewKeyNotice({ apiKey, onDismiss }: { apiKey: string; onDismiss: () => void }) {
  async function copyKey(): Promise<void> {
    await navigator.clipboard.writeText(apiKey)
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-emerald-500/5 p-5 ring-1 ring-emerald-500/20">
      <p className="text-sm font-medium text-white">
        Copy this API key now. It cannot be shown again.
      </p>
      <code className="overflow-x-auto rounded-lg bg-black/30 p-3 font-mono text-xs text-neutral-300 ring-1 ring-white/[0.08]">
        {apiKey}
      </code>
      <div className="flex gap-2">
        <Button className="rounded-lg" onClick={() => void copyKey()} size="sm" type="button">
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
    <form className="flex flex-col gap-4" onSubmit={onSubmit}>
      <h3 className="text-sm font-medium text-white">Create a key</h3>
      <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
        <div className="flex flex-col gap-1.5">
          <label className={fieldLabel} htmlFor="api-key-name">
            Key name
          </label>
          <Input
            className="h-10 rounded-lg"
            id="api-key-name"
            name="name"
            placeholder="Production deploys"
            required
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className={fieldLabel} htmlFor="api-key-expires">
            Expiry (optional)
          </label>
          <Input
            className="h-10 rounded-lg"
            id="api-key-expires"
            min="1"
            name="expiresInDays"
            placeholder="Expires in days"
            type="number"
          />
        </div>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className={`mb-2 ${fieldLabel}`}>Scopes</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {apiKeyScopes.map((scope) => (
            <div className="flex items-center gap-2" key={scope}>
              <Checkbox defaultChecked id={`scope-${scope}`} name="scopes" value={scope} />
              <Label className="font-mono text-xs text-neutral-300" htmlFor={`scope-${scope}`}>
                {scope}
              </Label>
            </div>
          ))}
        </div>
      </fieldset>
      <div className="flex justify-end">
        <Button className="rounded-lg" disabled={isSubmitting} type="submit">
          {isSubmitting ? 'Creating…' : 'Create API key'}
        </Button>
      </div>
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
    return (
      <Row>
        <p className="text-sm text-neutral-500">No API keys have been created.</p>
      </Row>
    )
  return keys.map((key) => (
    <div className="flex items-center gap-4 px-5 py-4" key={key.id}>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-white">{key.name ?? 'Untitled key'}</p>
        <p className="truncate font-mono text-xs text-neutral-500">
          {key.start ?? key.prefix ?? 'Hidden key'}
        </p>
      </div>
      <Pill tone={key.enabled ? 'green' : 'gray'}>{key.enabled ? 'active' : 'disabled'}</Pill>
      {canManage ? (
        <Button
          className="text-red-400 hover:text-red-300"
          disabled={isRevoking === key.id}
          onClick={() => void onRevoke(key.id)}
          size="sm"
          type="button"
          variant="ghost"
        >
          Revoke
        </Button>
      ) : null}
    </div>
  ))
}

function SourceForm({
  isSubmitting,
  onSubmit,
}: {
  isSubmitting: boolean
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>
}) {
  return (
    <form className="flex flex-col gap-4" onSubmit={onSubmit}>
      <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
        <div className="flex flex-col gap-1.5">
          <label className={fieldLabel} htmlFor="source-name">
            Source name
          </label>
          <Input
            className="h-10 rounded-lg"
            id="source-name"
            name="name"
            placeholder="GitHub production"
            required
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className={fieldLabel} htmlFor="source-provider">
            Provider
          </label>
          <Select defaultValue="github" name="provider">
            <SelectTrigger className="h-10 w-full rounded-lg" id="source-provider">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="github">GitHub</SelectItem>
              <SelectItem value="gitlab">GitLab</SelectItem>
              <SelectItem value="generic">Generic webhook</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <label className={fieldLabel} htmlFor="source-allowed-host">
          Allowed host
        </label>
        <Input
          className="h-10 rounded-lg"
          id="source-allowed-host"
          name="allowedHost"
          placeholder="https://api.github.com"
          required
          type="url"
        />
      </div>
      <div className="flex justify-end">
        <Button className="rounded-lg" disabled={isSubmitting} type="submit">
          {isSubmitting ? 'Adding…' : 'Add source'}
        </Button>
      </div>
    </form>
  )
}
