import { draftChannelSchema } from '@/lib/write/document'

/** One CSV import row: an existing asset ID or a selected filename, never a remote URL. */
export type ImportRow = { caption: string; asset: string; channels: string[] }

/**
 * What to fix in a row's channels before it can become a draft in a brand
 * with `connected` channels, or undefined. No channels is a valid unassigned
 * draft; a named channel must be supported and connected in the brand.
 */
export function channelProblem(channels: string[], connected: readonly string[]) {
  const unknown = channels.filter((channel) => !draftChannelSchema.safeParse(channel).success)
  if (unknown.length)
    return `Unknown channel ${unknown.join(', ')}. Use ${draftChannelSchema.options.join(', ')}, separated by semicolons.`
  const missing = channels.filter((channel) => !connected.includes(channel))
  if (missing.length)
    return `No connected ${missing.join(', ')} account in this publishing brand. Connect it, or remove it from this row's channels.`
}

/** Parse quoted CSV, including embedded newlines and escaped quotes, with strict bounds. */
export function parseDraftCSV(input: string): ImportRow[] {
  if (input.length > 1_000_000) throw new Error('CSV files must be smaller than 1 MB.')
  const rows: string[][] = []
  let row: string[] = [],
    field = '',
    quoted = false,
    closed = false
  const fieldEnd = () => {
    row.push(field)
    field = ''
    closed = false
  }
  const rowEnd = () => {
    fieldEnd()
    if (row.some((value) => value.trim())) rows.push(row)
    row = []
  }
  const text = input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          quoted = false
          closed = true
        }
      } else field += char
      continue
    }
    if (char === ',') fieldEnd()
    else if (char === '\n') rowEnd()
    else if (char === '"' && field === '' && !closed) quoted = true
    else if (closed || char === '"') throw new Error('Malformed CSV quoting.')
    else field += char
  }
  if (quoted) throw new Error('A quoted CSV field is unfinished.')
  rowEnd()
  const header = rows.shift()?.map((value) => value.trim().toLowerCase()) ?? []
  if (
    !header.includes('caption') ||
    header.some((key) => !['caption', 'asset', 'channels'].includes(key)) ||
    new Set(header).size !== header.length
  )
    throw new Error('Use CSV columns caption, asset, channels. Only caption is required.')
  if (!rows.length || rows.length > 50) throw new Error('Import between 1 and 50 rows.')
  return rows.map((values, index) => {
    if (values.length !== header.length)
      throw new Error(`Row ${index + 2} has the wrong number of fields.`)
    const data = Object.fromEntries(header.map((key, at) => [key, values[at]]))
    if (data.caption.length > 100_000) throw new Error(`Row ${index + 2} is too long.`)
    return {
      caption: data.caption,
      asset: (data.asset ?? '').trim(),
      channels: (data.channels ?? '')
        .split(';')
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean),
    }
  })
}
