'use client'

import { type FormEvent, useCallback, useEffect, useState } from 'react'
import { z } from 'zod'
import { Group, Pill, Row, Section } from '@/components/platform-ui'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
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
      await requestJson(`/api/enterprise/audit-drains/${drain.id}?${params}`, z.object({}), {
        method: 'DELETE',
      })
      await loadData()
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setPending(null)
    }
  }

  if (!canRead)
    return <p className="text-sm text-neutral-500">Audit logs are available to workspace admins.</p>
  return (
    <div className="flex flex-col gap-10">
      <Section title="Recent events">
        <div className="flex flex-col gap-3">
          <label className="sr-only" htmlFor="audit-search">
            Search audit events
          </label>
          <Input
            className="h-10 rounded-lg"
            id="audit-search"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by action, actor, or entity"
            type="search"
            value={search}
          />
          <WorkspaceAuditLogList logs={logs} />
        </div>
      </Section>
      {canManage ? (
        <RetentionForm
          isSubmitting={pending === 'retention'}
          onSubmit={updateRetention}
          retention={retention}
        />
      ) : null}
      <Section
        description="Send signed audit events to your security platform."
        title="SIEM log drains"
      >
        <Group>
          <DrainList drains={drains} isDeleting={pending} onDelete={deleteDrain} />
          {canManage ? (
            <Row>
              <DrainForm isSubmitting={pending === 'drain'} onSubmit={createDrain} />
            </Row>
          ) : null}
        </Group>
      </Section>
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
    <Section
      description="Changing this policy requires a recent sign-in and two-factor authentication."
      title="Retention policy"
    >
      <form className="flex flex-col gap-4" onSubmit={onSubmit}>
        <Group>
          <Row
            description="Between 30 and 3650 days."
            label={<label htmlFor="retention-days">Retention days</label>}
          >
            <Input
              className="h-10 rounded-lg md:w-40"
              defaultValue={retention.retentionDays}
              id="retention-days"
              max="3650"
              min="30"
              name="retentionDays"
              required
              type="number"
            />
          </Row>
          <Row
            description="Keeps every event past the retention window."
            label={<label htmlFor="legal-hold">Place audit data on legal hold</label>}
            layout="inline"
          >
            <Checkbox defaultChecked={retention.legalHold} id="legal-hold" name="legalHold" />
          </Row>
        </Group>
        <div className="flex justify-end">
          <Button className="rounded-lg" disabled={isSubmitting} type="submit">
            {isSubmitting ? 'Saving…' : 'Save retention'}
          </Button>
        </div>
      </form>
    </Section>
  )
}

function DrainForm({
  isSubmitting,
  onSubmit,
}: {
  isSubmitting: boolean
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>
}) {
  const fieldLabel = 'text-xs font-medium text-neutral-400'
  return (
    <form className="flex flex-col gap-4" onSubmit={onSubmit}>
      <h3 className="text-sm font-medium text-white">Add a drain</h3>
      <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
        <div className="flex flex-col gap-1.5">
          <label className={fieldLabel} htmlFor="drain-name">
            Drain name
          </label>
          <Input
            className="h-10 rounded-lg"
            id="drain-name"
            name="name"
            placeholder="Production SIEM"
            required
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className={fieldLabel} htmlFor="drain-provider">
            Provider
          </label>
          <Select defaultValue="GENERIC" name="provider">
            <SelectTrigger className="h-10 w-full rounded-lg" id="drain-provider">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="GENERIC">Generic</SelectItem>
              <SelectItem value="SPLUNK">Splunk</SelectItem>
              <SelectItem value="DATADOG">Datadog</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <label className={fieldLabel} htmlFor="drain-endpoint">
          Endpoint URL
        </label>
        <Input
          className="h-10 rounded-lg"
          id="drain-endpoint"
          name="endpoint"
          placeholder="https://siem.example/events"
          required
          type="url"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className={fieldLabel} htmlFor="drain-signing-secret">
          Signing secret
        </label>
        <Input
          className="h-10 rounded-lg"
          id="drain-signing-secret"
          minLength={16}
          name="signingSecret"
          placeholder="Signing secret"
          required
          type="password"
        />
      </div>
      <div className="flex justify-end">
        <Button className="rounded-lg" disabled={isSubmitting} type="submit">
          {isSubmitting ? 'Adding…' : 'Add log drain'}
        </Button>
      </div>
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
  if (drains.length === 0)
    return (
      <Row>
        <p className="text-sm text-neutral-500">No SIEM drains are configured.</p>
      </Row>
    )
  return drains.map((drain) => (
    <div className="flex items-center gap-4 px-5 py-4" key={drain.id}>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-white">{drain.name}</p>
        <p className="truncate font-mono text-xs text-neutral-500">{drain.endpoint}</p>
      </div>
      <Pill>{drain.provider}</Pill>
      <Pill tone={drain.enabled ? 'green' : 'gray'}>{drain.enabled ? 'active' : 'disabled'}</Pill>
      <Button
        className="text-red-400 hover:text-red-300"
        disabled={isDeleting === drain.id}
        onClick={() => void onDelete(drain)}
        size="sm"
        type="button"
        variant="ghost"
      >
        Remove
      </Button>
    </div>
  ))
}
