import { z } from 'zod'

/** Validate serialized responses against existing Date-to-ISO boundary codecs. */
export function readWire<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  return z.decode(schema, z.encode(schema, value as z.output<S>))
}
