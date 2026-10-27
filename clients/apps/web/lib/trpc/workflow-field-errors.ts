import { TRPCError } from '@trpc/server'
import { ZodError } from 'zod'

/** Expose input issue paths and messages only for workflow draft validation. */
export function workflowFieldErrors(error: TRPCError, path: string | undefined) {
  if (
    path !== 'releaseAutomation.save' ||
    error.code !== 'BAD_REQUEST' ||
    !(error.cause instanceof ZodError)
  )
    return []
  return error.cause.issues.map((issue) => ({
    field: issue.path.join('.'),
    message: issue.message,
  }))
}
