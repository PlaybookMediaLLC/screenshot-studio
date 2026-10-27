import JSZip from 'jszip'

/** One file in an archive: a relative path (folders with `/`) and its bytes. */
export type ZipEntry = { data: Blob | Uint8Array; path: string }

/** Characters no portable file name may hold. */
// eslint-disable-next-line no-control-regex
const UNSAFE_NAME_CHARACTER = /[\\:*?"<>|\u0000-\u001f]/

/** True for a relative path whose every segment is a plain, portable name. */
function isSafePath(path: string): boolean {
  return path
    .split('/')
    .every(
      (part) => part !== '' && part !== '.' && part !== '..' && !UNSAFE_NAME_CHARACTER.test(part)
    )
}

/**
 * A ZIP of the given files. Images, PDFs, and videos are already compressed,
 * so they are stored as they are (fast, and nothing to gain); SVG is text and
 * is deflated.
 */
export async function zipFiles(entries: readonly ZipEntry[]): Promise<Blob> {
  if (entries.length === 0) throw new Error('There is nothing to put in the ZIP.')
  const zip = new JSZip()
  const seen = new Set<string>()
  for (const entry of entries) {
    if (!isSafePath(entry.path)) throw new Error(`Unsafe file name in the ZIP: ${entry.path}`)
    const key = entry.path.toLowerCase()
    if (seen.has(key)) throw new Error(`Two files would share the name ${entry.path}.`)
    seen.add(key)
    zip.file(entry.path, entry.data, {
      binary: true,
      compression: entry.path.endsWith('.svg') ? 'DEFLATE' : 'STORE',
    })
  }
  return zip.generateAsync({ mimeType: 'application/zip', type: 'blob' })
}
