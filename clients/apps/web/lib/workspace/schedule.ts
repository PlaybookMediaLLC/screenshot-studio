export function getNextWorkspacePublishTime(input: {
  now?: Date
  timeZone: string
  time: string
}): Date {
  const now = input.now ?? new Date()
  const [hours, minutes] = input.time.split(':').map(Number)
  const parts = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone: input.timeZone,
    year: 'numeric',
  }).formatToParts(now)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  const year = Number(values.year)
  const month = Number(values.month)
  const day = Number(values.day)

  function offsetAt(timestamp: number): number {
    const local = new Intl.DateTimeFormat('en-CA', {
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
      minute: '2-digit',
      month: '2-digit',
      timeZone: input.timeZone,
      year: 'numeric',
    }).formatToParts(new Date(timestamp))
    const output = Object.fromEntries(local.map((part) => [part.type, part.value]))
    return (
      Date.UTC(
        Number(output.year),
        Number(output.month) - 1,
        Number(output.day),
        Number(output.hour),
        Number(output.minute)
      ) - timestamp
    )
  }

  function toUtc(targetDay: number): Date {
    const localTimestamp = Date.UTC(year, month - 1, targetDay, hours, minutes)
    let timestamp = localTimestamp
    // The offset can change at a DST boundary. A second pass makes the
    // conversion converge without a timezone dependency.
    timestamp = localTimestamp - offsetAt(timestamp)
    timestamp = localTimestamp - offsetAt(timestamp)
    return new Date(timestamp)
  }

  const today = toUtc(day)
  return today > now ? today : toUtc(day + 1)
}
