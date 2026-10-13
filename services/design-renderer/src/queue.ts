export class QueueFullError extends Error {}
export class QueueTimeoutError extends Error {}
export class DrainingError extends Error {}

type Waiter = { start: () => void; reject: (error: Error) => void }

/** FIFO admission with a reserved slot on handoff and removable waiters. */
export class RenderQueue {
  active = 0
  draining = false
  private waiting: Waiter[] = []

  constructor(
    private concurrency: number,
    private maxQueue: number,
    private waitMs: number
  ) {}

  get queued() {
    return this.waiting.length
  }

  drain() {
    this.draining = true
    for (const waiter of [...this.waiting]) waiter.reject(new DrainingError())
  }

  private async acquire(signal: AbortSignal) {
    signal.throwIfAborted()
    if (this.draining) throw new DrainingError()
    if (this.active < this.concurrency) {
      this.active += 1
      return
    }
    if (this.queued >= this.maxQueue) throw new QueueFullError()
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer)
        signal.removeEventListener('abort', abort)
        this.waiting = this.waiting.filter((entry) => entry !== waiter)
      }
      const waiter: Waiter = {
        start: () => {
          cleanup()
          this.active += 1
          resolve()
        },
        reject: (error) => {
          cleanup()
          reject(error)
        },
      }
      const abort = () => waiter.reject(signal.reason)
      const timer = setTimeout(() => waiter.reject(new QueueTimeoutError()), this.waitMs)
      this.waiting.push(waiter)
      signal.addEventListener('abort', abort, { once: true })
    })
  }

  async run<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
    await this.acquire(signal)
    try {
      signal.throwIfAborted()
      if (this.draining) throw new DrainingError()
      return await work()
    } finally {
      this.active -= 1
      this.waiting[0]?.start()
    }
  }
}
