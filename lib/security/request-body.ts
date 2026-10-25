/** Default JSON budget includes the existing 16 MB base64 upload contracts. */
export const MAX_REQUEST_BYTES = 32 * 1024 * 1024

export class RequestBodyTooLargeError extends Error {
  readonly status = 413

  constructor() {
    super('The request body exceeds the allowed size.')
    this.name = 'RequestBodyTooLargeError'
  }
}

/** Count actual streamed bytes; Content-Length alone is neither required nor trusted. */
export async function readBoundedBody(
  request: Request,
  maxBytes = MAX_REQUEST_BYTES
): Promise<Uint8Array> {
  const declared = Number(request.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) {
    await request.body?.cancel().catch(() => undefined)
    throw new RequestBodyTooLargeError()
  }
  if (!request.body) return new Uint8Array()
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxBytes) {
        await reader.cancel().catch(() => undefined)
        throw new RequestBodyTooLargeError()
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const body = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

/** Read exact UTF-8 text without allowing unbounded buffering before schema/signature checks. */
export async function readBoundedText(
  request: Request,
  maxBytes = MAX_REQUEST_BYTES
): Promise<string> {
  return new TextDecoder().decode(await readBoundedBody(request, maxBytes))
}

/** Preserve vendor handler semantics while applying the shared byte limit. */
export async function withBoundedBody(request: Request): Promise<Request> {
  if (!request.body) return request
  return new Request(request, { body: new Uint8Array(await readBoundedBody(request)) })
}
