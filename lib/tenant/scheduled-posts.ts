import 'server-only'

import { randomUUID } from 'node:crypto'

export class ScheduledPostError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409
  ) {
    super(message)
    this.name = 'ScheduledPostError'
  }
}

export function getScheduledPostIdempotencyKey(requestId: string | null): string {
  return requestId?.slice(0, 128) || randomUUID()
}
