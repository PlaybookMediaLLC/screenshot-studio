import { Group, Pill, type PillTone, Row } from '@/components/platform-ui'
import type { AuditLog } from './WorkspaceAuditSettings'

type WorkspaceAuditLogListProps = { logs: AuditLog[] }

const outcomeTones: Record<string, PillTone> = { DENIED: 'red', FAILED: 'red', SUCCEEDED: 'green' }

export function WorkspaceAuditLogList({ logs }: WorkspaceAuditLogListProps) {
  return (
    <Group>
      {logs.length === 0 ? (
        <Row>
          <p className="text-sm text-neutral-500">No audit events have been recorded.</p>
        </Row>
      ) : (
        logs.map((log) => (
          <div className="flex items-center gap-4 px-5 py-4" key={log.id}>
            <div className="min-w-0 flex-1">
              <p className="truncate font-mono text-sm text-white">{log.action}</p>
              <p className="truncate text-xs text-neutral-500">
                {log.actorDisplay ?? 'System'} · {log.entityType} ·{' '}
                {new Date(log.createdAt).toLocaleString()}
              </p>
            </div>
            <Pill tone={outcomeTones[log.outcome] ?? 'gray'}>
              <span className="capitalize">{log.outcome.toLowerCase()}</span>
            </Pill>
          </div>
        ))
      )}
    </Group>
  )
}
