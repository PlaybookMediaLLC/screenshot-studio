/** A summary counts as displayed only after 500 continuous milliseconds in the active viewport. */
export function observeNotificationSummary(
  element: HTMLElement,
  root: HTMLElement | null,
  acknowledge: () => Promise<void>
) {
  const doc = element.ownerDocument
  const win = doc.defaultView
  if (!win || !('IntersectionObserver' in win)) return () => undefined
  let visible = false
  let disposed = false
  let complete = false
  let sending = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const clear = () => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
  }
  const active = () => !disposed && visible && doc.visibilityState === 'visible' && doc.hasFocus()
  const schedule = (delay = 500) => {
    clear()
    if (!active() || complete || sending) return
    timer = setTimeout(() => {
      if (!active()) return
      sending = true
      void acknowledge()
        .then(() => {
          complete = true
        })
        .catch(() => {
          if (!disposed) {
            sending = false
            schedule(2000)
          }
        })
        .finally(() => {
          sending = false
        })
    }, delay)
  }
  const update = () => schedule()
  const observer = new IntersectionObserver(
    ([entry]) => {
      visible = !!entry?.isIntersecting && entry.intersectionRatio >= 1
      schedule()
    },
    { root, threshold: 1 }
  )
  observer.observe(element)
  doc.addEventListener('visibilitychange', update)
  win.addEventListener('focus', update)
  win.addEventListener('blur', update)
  return () => {
    disposed = true
    clear()
    observer.disconnect()
    doc.removeEventListener('visibilitychange', update)
    win.removeEventListener('focus', update)
    win.removeEventListener('blur', update)
  }
}
