import type { UsageOutcome } from './usage'

export interface TerminalObservation {
  readonly outcome: UsageOutcome
  readonly usage?: unknown
  readonly finishReason?: unknown
}

interface StreamPart {
  readonly type: string
  readonly usage?: unknown
  readonly finishReason?: unknown
  readonly error?: unknown
}

interface StreamTapState {
  readonly reader: StreamReader<StreamPart>
  readonly report: (terminal: TerminalObservation) => void
  latestUsage?: unknown
  cancelled: boolean
  released: boolean
}

interface StreamReader<T> {
  cancel(reason?: unknown): Promise<void>
  read(): Promise<{ readonly done: boolean; readonly value?: T }>
  releaseLock(): void
}

export const usageFromError = (error: unknown): unknown => {
  if (!error || typeof error !== 'object') {
    return undefined
  }
  const record = error as Record<string, unknown>
  const data = record.data
  if (record.usage !== undefined) {
    return record.usage
  }
  if (data && typeof data === 'object' && 'usage' in data) {
    return (data as { usage?: unknown }).usage
  }
  return 'inputTokens' in record || 'promptTokens' in record ? record : undefined
}

export const errorOutcome = (error: unknown): UsageOutcome => {
  const identity = error as { code?: unknown; name?: unknown } | undefined
  return identity?.name === 'AbortError' || identity?.code === 'ABORT_ERR' ? 'abort' : 'error'
}

const releaseReader = (state: StreamTapState): void => {
  if (state.released) {
    return
  }
  state.released = true
  state.reader.releaseLock()
}

const closeStream = (
  state: StreamTapState,
  controller: ReadableStreamDefaultController<StreamPart>
): void => {
  state.report({ outcome: 'error', usage: state.latestUsage })
  releaseReader(state)
  if (!state.cancelled) {
    controller.close()
  }
}

const reportPart = (state: StreamTapState, part: StreamPart): void => {
  state.latestUsage = part.usage ?? usageFromError(part.error) ?? state.latestUsage
  if (part.type === 'finish') {
    state.report({
      outcome: 'finish',
      usage: state.latestUsage,
      finishReason: part.finishReason,
    })
  } else if (part.type === 'error') {
    state.report({ outcome: errorOutcome(part.error), usage: state.latestUsage })
  }
}

const reportReadError = (
  state: StreamTapState,
  controller: ReadableStreamDefaultController<StreamPart>,
  error: unknown
): void => {
  state.report({
    outcome: errorOutcome(error),
    usage: usageFromError(error) ?? state.latestUsage,
  })
  releaseReader(state)
  if (!state.cancelled) {
    controller.error(error)
  }
}

const forwardNextPart = async (
  state: StreamTapState,
  controller: ReadableStreamDefaultController<StreamPart>
): Promise<void> => {
  try {
    const result = await state.reader.read()
    if (result.done || !result.value) {
      closeStream(state, controller)
      return
    }
    reportPart(state, result.value)
    controller.enqueue(result.value)
  } catch (error) {
    reportReadError(state, controller, error)
  }
}

const cancelStream = async (state: StreamTapState, reason: unknown): Promise<void> => {
  state.cancelled = true
  state.report({
    outcome: 'cancel',
    usage: usageFromError(reason) ?? state.latestUsage,
  })
  try {
    await state.reader.cancel(reason)
  } finally {
    releaseReader(state)
  }
}

export const tapStreamUsage = (
  stream: ReadableStream<StreamPart>,
  report: (terminal: TerminalObservation) => void
): ReadableStream<StreamPart> => {
  const state: StreamTapState = {
    reader: stream.getReader(),
    report,
    cancelled: false,
    released: false,
  }
  return new ReadableStream({
    pull: (controller) => forwardNextPart(state, controller),
    cancel: (reason) => cancelStream(state, reason),
  })
}
