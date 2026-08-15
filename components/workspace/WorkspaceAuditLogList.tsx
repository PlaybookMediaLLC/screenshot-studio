import type { AuditLog } from './WorkspaceAuditSettings'

type WorkspaceAuditLogListProps = { logs: AuditLog[] }

export function WorkspaceAuditLogList({ logs }: WorkspaceAuditLogListProps) {
  return (
    <section className="grid gap-3">
      <h3 className="text-sm font-semibold">Recent events</h3>
      {logs.length === 0 ? (
        <p className="text-sm text-muted-foreground">No audit events have been recorded.</p>
      ) : (
        <ul className="overflow-hidden rounded-md border border-foreground/10">
          {logs.map((log) => (
            <li
              className="grid gap-1 border-b border-foreground/10 px-4 py-3 text-sm last:border-b-0"
              key={log.id}
            >
              <span className="font-medium">{log.action}</span>
              <span className="text-xs text-muted-foreground">
                {log.actorDisplay ?? 'System'} · {log.entityType} ·{' '}
                {new Date(log.createdAt).toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
