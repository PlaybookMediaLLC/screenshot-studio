export class WorkspaceError extends Error {
  constructor(
    message: string,
    // 503 covers an interactive-transaction timeout: the request was valid
    // and the dependency was too slow, so the caller may retry.
    readonly status: 400 | 403 | 404 | 409 | 429 | 503
  ) {
    super(message)
    this.name = 'WorkspaceError'
  }
}
