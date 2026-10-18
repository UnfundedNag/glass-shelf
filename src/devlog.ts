// Dev builds only: sends diagnostic lines to the Vite dev server, which
// appends them to build/device.log on the dev machine. The phone's WebView
// console is otherwise out of reach. Production builds compile this away,
// and tests skip it.
const enabled = import.meta.env.DEV && import.meta.env.MODE !== 'test'

export function devlog(...parts: unknown[]): void {
  if (!enabled) return
  const line = parts.map(p => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ')
  void fetch('/__devlog', { method: 'POST', body: `${new Date().toISOString()} ${line}` }).catch(() => {})
}

if (enabled) {
  addEventListener('error', e => devlog('[error]', e.message, `${e.filename}:${e.lineno}`))
  addEventListener('unhandledrejection', e => devlog('[unhandled]', String((e as PromiseRejectionEvent).reason)))
  addEventListener('visibilitychange', () => devlog('[visibility]', document.visibilityState))
  addEventListener('pagehide', () => devlog('[pagehide]'))
  devlog('[load]', location.href)
}
