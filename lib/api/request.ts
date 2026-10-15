import type { ZodType } from 'zod'
import { validationErrorNameSchema } from '@/lib/api/platform-errors'

/** Read the request body as JSON and parse it with `schema`. */
export async function parseJson<T>(request: Request, schema: ZodType<T>): Promise<T> {
  const body: unknown = await request.json()
  return schema.parse(body)
}

/** Whether `error` is a malformed-JSON or schema-validation failure. */
export function isInvalidRequest(error: unknown): boolean {
  return error instanceof Error && validationErrorNameSchema.safeParse(error.name).success
}
