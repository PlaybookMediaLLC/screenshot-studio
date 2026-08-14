import { ZodError, type ZodType } from 'zod'

export async function parseJson<T>(request: Request, schema: ZodType<T>): Promise<T> {
  const body: unknown = await request.json()
  return schema.parse(body)
}

export function isInvalidRequest(error: unknown): boolean {
  return error instanceof SyntaxError || error instanceof ZodError
}
