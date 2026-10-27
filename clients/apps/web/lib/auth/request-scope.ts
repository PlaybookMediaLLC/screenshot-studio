import { z } from 'zod'

/** The person and workspace a browser operation started in. */
export const workspaceRequestScopeSchema = z.object({
  userId: z.string().min(1).max(160),
  workspaceId: z.string().min(1).max(160),
})

/** A caller expectation that narrows session authority; it never grants access. */
export type WorkspaceRequestScope = z.infer<typeof workspaceRequestScopeSchema>

/** Bind a browser request to the context displayed when it began. */
export function workspaceScopeHeaders(scope: WorkspaceRequestScope) {
  return { 'x-playbook-user': scope.userId, 'x-playbook-workspace': scope.workspaceId }
}

/** Legacy callers omit both headers; scoped callers must match both identities. */
export function matchesWorkspaceScope(headers: Headers, scope: WorkspaceRequestScope): boolean {
  const user = headers.get('x-playbook-user')
  const workspace = headers.get('x-playbook-workspace')
  return (
    (user === null && workspace === null) ||
    (user === scope.userId && workspace === scope.workspaceId)
  )
}
