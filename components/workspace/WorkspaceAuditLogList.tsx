import { Group, Pill, type PillTone, Row } from '@/components/platform-ui'
import type { AuditLog } from './WorkspaceAuditSettings'

type WorkspaceAuditLogListProps = { logs: AuditLog[]; search?: string }

const outcomeTones: Record<string, PillTone> = { DENIED: 'red', FAILED: 'red', SUCCEEDED: 'green' }

export function WorkspaceAuditLogList({ logs, search }: WorkspaceAuditLogListProps) {
  return (
    <Group>
      {logs.length === 0 ? (
        <Row>
          <p className="text-sm text-muted-foreground">
            {search ? 'No events match your search.' : 'No audit events have been recorded.'}
          </p>
        </Row>
      ) : (
        logs.map((log) => (
          <div className="flex items-center gap-4 px-5 py-4" key={log.id}>
            <div className="min-w-0 flex-1">
              <p className="truncate font-mono text-sm text-foreground">{log.action}</p>
              <p className="truncate text-xs text-muted-foreground">
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
