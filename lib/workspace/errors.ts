export class WorkspaceError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409 | 429
  ) {
    super(message)
    this.name = 'WorkspaceError'
  }
}
