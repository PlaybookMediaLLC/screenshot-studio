const UNAVAILABLE = 'The service is temporarily unavailable. Please try again in a moment.'

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer)
      reject(signal.reason)
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, ms)
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
  })
}

/** Bypass cached API failures and retry reads only; a failed mutation may already have committed. */
export async function browserTRPCFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const read = (init?.method ?? 'GET').toUpperCase() === 'GET'
  const signal = read
    ? AbortSignal.any([...(init?.signal ? [init.signal] : []), AbortSignal.timeout(20_000)])
    : (init?.signal ?? new AbortController().signal)
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(input, { ...init, cache: 'no-store', signal })
      if (read && [502, 503, 504].includes(response.status) && attempt < 2) {
        await response.body?.cancel()
        await pause(500 * 2 ** attempt, signal)
        continue
      }
      if (!response.headers.get('content-type')?.includes('application/json')) {
        await response.body?.cancel()
        throw new Error(UNAVAILABLE)
      }
      // Proxies can mislabel HTML as JSON; keep parser errors out of the UI too.
      await response.clone().json()
      return response
    } catch (error) {
      if (init?.signal?.aborted) throw error
      if (signal.aborted) throw new Error('The request took too long. Please try again.')
      // Browser fetch reports network failures as TypeError.
      if (read && error instanceof TypeError && attempt < 2) {
        await pause(500 * 2 ** attempt, signal)
        continue
      }
      throw new Error(UNAVAILABLE, { cause: error })
    }
  }
}
