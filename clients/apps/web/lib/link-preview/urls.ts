/** Whether a value is an absolute web URL suitable for exported image metadata. */
export function isHttpUrl(value: string): boolean {
  if (!/^https?:\/\//i.test(value) || /\s/.test(value)) return false
  try {
    const url = new URL(value)
    return !!url.hostname && !url.username && !url.password
  } catch {
    return false
  }
}
