/** Install before hydration so a missing layout chunk still leaves a working reload control. */
export function installDeploymentRecovery() {
  function showReload() {
    if (!document.body) {
      document.addEventListener('DOMContentLoaded', showReload, { once: true })
      return
    }
    if (document.getElementById('deployment-recovery')) return
    const notice = document.createElement('div')
    notice.id = 'deployment-recovery'
    notice.setAttribute('role', 'alert')
    notice.style.cssText =
      'position:fixed;inset:16px 16px auto;z-index:2147483647;padding:16px;background:#18181b;color:white;border:2px solid white;border-radius:8px;font:14px system-ui'
    const message = document.createElement('p')
    message.textContent = 'An app update interrupted loading. Reload to get the latest version.'
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = 'Reload page'
    button.style.cssText =
      'margin-top:8px;padding:8px 16px;background:white;color:#18181b;border-radius:4px;cursor:pointer'
    button.onclick = () => window.location.reload()
    notice.append(message, button)
    document.body.appendChild(notice)
  }
  window.addEventListener(
    'error',
    (event) => {
      const target = event.target
      if (target instanceof HTMLScriptElement && target.src.includes('/_next/static/')) showReload()
      else if (
        /ChunkLoadError|Loading chunk .+ failed|Failed to fetch dynamically imported module/.test(
          event.message ?? ''
        )
      )
        showReload()
    },
    true
  )
  window.addEventListener('unhandledrejection', (event) => {
    if (
      /ChunkLoadError|Loading chunk .+ failed|Failed to fetch dynamically imported module/.test(
        String(event.reason)
      )
    )
      showReload()
  })
}
