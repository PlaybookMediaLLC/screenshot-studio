'use client'

import { type FormEvent, useCallback, useEffect, useState } from 'react'
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
import { WorkspaceAuditLogList } from './WorkspaceAuditLogList'
import { getErrorMessage, requestJson } from './settings-client'

const auditLogSchema = z.object({
  action: z.string(),
  actorDisplay: z.string().nullable(),
  createdAt: z.string(),
  entityType: z.string(),
  id: z.string(),
  outcome: z.string(),
})
const auditLogsSchema = z.object({ items: z.array(auditLogSchema) })
const retentionSchema = z.object({ legalHold: z.boolean(), retentionDays: z.number() })
const auditDrainSchema = z.object({
  enabled: z.boolean(),
  endpoint: z.string().url(),
  id: z.string(),
  name: z.string(),
  provider: z.string(),
})
const auditDrainsSchema = z.object({ drains: z.array(auditDrainSchema) })

type WorkspaceAuditSettingsProps = { canManage: boolean; canRead: boolean; organizationId: string }
type AuditDrain = z.infer<typeof auditDrainSchema>
export type AuditLog = z.infer<typeof auditLogSchema>

export function WorkspaceAuditSettings({
  canManage,
  canRead,
  organizationId,
}: WorkspaceAuditSettingsProps) {
  const [drains, setDrains] = useState<AuditDrain[]>([])
  const [error, setError] = useState<string | null>(null)
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [pending, setPending] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [retention, setRetention] = useState<z.infer<typeof retentionSchema>>({
    legalHold: false,
    retentionDays: 90,
  })

  const loadData = useCallback(async (): Promise<void> => {
    if (!canRead) return
    try {
      const query = new URLSearchParams({ organizationId })
      if (search.trim()) {
        query.set('search', search.trim())
      }
      const [auditLogs, auditRetention, auditDrains] = await Promise.all([
        requestJson(`/api/audit-logs?${query}`, auditLogsSchema),
        requestJson(`/api/enterprise/audit-retention?${query}`, retentionSchema),
        requestJson(`/api/enterprise/audit-drains?${query}`, auditDrainsSchema),
      ])
      setDrains(auditDrains.drains)
      setLogs(auditLogs.items)
      setRetention(auditRetention)
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    }
  }, [canRead, organizationId, search])

  useEffect(() => {
    void loadData()
  }, [loadData])

  async function updateRetention(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setError(null)
    setPending('retention')
    try {
      const data = new FormData(event.currentTarget)
      const result = await requestJson('/api/enterprise/audit-retention', retentionSchema, {
        body: {
          legalHold: data.get('legalHold') === 'on',
          organizationId,
          retentionDays: Number(data.get('retentionDays')),
        },
        method: 'PUT',
      })
      setRetention(result)
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setPending(null)
    }
  }

  async function createDrain(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setError(null)
    setPending('drain')
    const form = event.currentTarget
    try {
      const data = Object.fromEntries(new FormData(form))
      await requestJson('/api/enterprise/audit-drains', z.unknown(), {
        body: { ...data, organizationId },
        method: 'POST',
      })
      form.reset()
      await loadData()
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setPending(null)
    }
  }

  async function deleteDrain(drain: AuditDrain): Promise<void> {
    setError(null)
    setPending(drain.id)
    try {
      const params = new URLSearchParams({ organizationId })
      await requestJson(
        `/api/enterprise/audit-drains/${drain.id}?${params}`,
        z.object({}),
        { method: 'DELETE' }
      )
      await loadData()
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setPending(null)
    }
  }

  if (!canRead)
    return (
      <p className="text-sm text-muted-foreground">Audit logs are available to workspace admins.</p>
    )
  return (
    <div className="grid max-w-3xl gap-8">
      <div className="grid gap-3">
        <Label htmlFor="audit-search">Search audit events</Label>
        <Input
          id="audit-search"
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by action, actor, or entity"
          type="search"
          value={search}
        />
        <WorkspaceAuditLogList logs={logs} />
      </div>
      {canManage ? (
        <RetentionForm
          isSubmitting={pending === 'retention'}
          onSubmit={updateRetention}
          retention={retention}
        />
      ) : null}
      {canManage ? <DrainForm isSubmitting={pending === 'drain'} onSubmit={createDrain} /> : null}
      <DrainList drains={drains} isDeleting={pending} onDelete={deleteDrain} />
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  )
}

function RetentionForm({
  isSubmitting,
  onSubmit,
  retention,
}: {
  isSubmitting: boolean
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>
  retention: z.infer<typeof retentionSchema>
}) {
  return (
    <form className="grid gap-4 border-t border-foreground/10 pt-8" onSubmit={onSubmit}>
      <div>
        <h3 className="text-sm font-semibold">Retention policy</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Changing this policy requires a recent sign-in and two-factor authentication.
        </p>
      </div>
      <Label className="grid w-44 gap-1.5" htmlFor="retention-days">
        Retention days
        <Input
          defaultValue={retention.retentionDays}
          id="retention-days"
          max="3650"
          min="30"
          name="retentionDays"
          required
          type="number"
        />
      </Label>
      <div className="flex items-center gap-2">
        <Checkbox defaultChecked={retention.legalHold} id="legal-hold" name="legalHold" />
        <Label htmlFor="legal-hold">Place audit data on legal hold</Label>
      </div>
      <Button className="w-fit" disabled={isSubmitting} type="submit">
        {isSubmitting ? 'Saving…' : 'Save retention'}
      </Button>
    </form>
  )
}

function DrainForm({
  isSubmitting,
  onSubmit,
}: {
  isSubmitting: boolean
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>
}) {
  return (
    <form className="grid gap-4 border-t border-foreground/10 pt-8" onSubmit={onSubmit}>
      <div>
        <h3 className="text-sm font-semibold">SIEM log drain</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Send signed audit events to your security platform.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Input name="name" placeholder="Production SIEM" required />
        <Select defaultValue="GENERIC" name="provider">
          <SelectTrigger className="h-10 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="GENERIC">Generic</SelectItem>
            <SelectItem value="SPLUNK">Splunk</SelectItem>
            <SelectItem value="DATADOG">Datadog</SelectItem>
          </SelectContent>
        </Select>
        <Input name="endpoint" placeholder="https://siem.example/events" required type="url" />
      </div>
      <Input
        minLength={16}
        name="signingSecret"
        placeholder="Signing secret"
        required
        type="password"
      />
      <Button className="w-fit" disabled={isSubmitting} type="submit">
        {isSubmitting ? 'Adding…' : 'Add log drain'}
      </Button>
    </form>
  )
}

function DrainList({
  drains,
  isDeleting,
  onDelete,
}: {
  drains: AuditDrain[]
  isDeleting: string | null
  onDelete: (drain: AuditDrain) => Promise<void>
}) {
  return (
    <section className="grid gap-3">
      <h3 className="text-sm font-semibold">Configured drains</h3>
      {drains.length === 0 ? (
        <p className="text-sm text-muted-foreground">No SIEM drains are configured.</p>
      ) : (
        <ul className="overflow-hidden rounded-md border border-foreground/10">
          {drains.map((drain) => (
            <li
              className="flex items-center justify-between gap-3 border-b border-foreground/10 px-4 py-3 text-sm last:border-b-0"
              key={drain.id}
            >
              <div>
                <p className="font-medium">{drain.name}</p>
                <p className="text-xs text-muted-foreground">
                  {drain.provider} · {drain.enabled ? 'active' : 'disabled'}
                </p>
              </div>
              <Button
                disabled={isDeleting === drain.id}
                onClick={() => void onDelete(drain)}
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
