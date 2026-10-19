// fetch that gives up if the server has not started answering within
// `timeoutMs`. A dropped connection (a VPN that does not route the server, a
// firewall that drops instead of refusing) otherwise hangs forever. Only the
// wait for the response headers is limited, so a slow book download is not
// cut off.
export const RESPONSE_TIMEOUT_MS = 15_000

export async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = RESPONSE_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}
