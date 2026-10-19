const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const record = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const keyed = (values: unknown[]): values is Array<Record<string, unknown> & { id: string }> =>
  values.every((value) => record(value) && typeof value.id === 'string')

/** A published update changes only values still equal to the previous assignment, including stable-ID layers. */
export function mergeAssigned(base: unknown, local: unknown, update: unknown): unknown {
  if (same(local, base)) return structuredClone(update)
  if (
    Array.isArray(base) &&
    Array.isArray(local) &&
    Array.isArray(update) &&
    keyed(base) &&
    keyed(local) &&
    keyed(update)
  ) {
    const originals = new Map(base.map((value) => [value.id, value]))
    const current = new Map(local.map((value) => [value.id, value]))
    const proposed = new Map(update.map((value) => [value.id, value]))
    const locallyOrdered = !same(
      local.filter((value) => originals.has(value.id)).map((value) => value.id),
      base.filter((value) => current.has(value.id)).map((value) => value.id)
    )
    const order = locallyOrdered ? [...local, ...update] : [...update, ...local]
    const result: unknown[] = []
    const seen = new Set<string>()
    for (const { id } of order) {
      if (seen.has(id)) continue
      seen.add(id)
      if (originals.has(id) && !current.has(id)) continue
      const value = mergeAssigned(originals.get(id), current.get(id), proposed.get(id))
      if (value !== undefined) result.push(value)
    }
    return result
  }
  if (record(base) && record(local) && record(update)) {
    const result: Record<string, unknown> = {}
    for (const key of new Set([
      ...Object.keys(base),
      ...Object.keys(local),
      ...Object.keys(update),
    ])) {
      const value = mergeAssigned(base[key], local[key], update[key])
      if (value !== undefined) result[key] = value
    }
    return result
  }
  return structuredClone(local)
}
