import { fetchWithTimeout } from '../opds/fetch'
import type { Settings } from '../store/settings'

// One record per document on a KOReader sync server.
export type RemoteProgress = {
  progress?: string
  percentage?: number
  device?: string
  device_id?: string
  // Unix seconds.
  timestamp?: number
}

export type ProgressUpdate = {
  document: string
  progress: string
  percentage: number
  device: string
  device_id: string
}

// HTTP Basic works on Calibre-Web-Automated, including servers that log in
// through an external provider and so cannot check KOReader's md5 key (SPEC
// §4.2). Stock kosync servers only take the md5 key headers.
export type AuthMode = 'basic' | 'key'

export class KosyncError extends Error {
  constructor(
    message: string,
    readonly kind: 'auth' | 'network' | 'http',
  ) {
    super(message)
  }
}

export class KosyncClient {
  private mode: AuthMode

  constructor(
    private readonly settings: Settings,
    mode: AuthMode = 'basic',
  ) {
    this.mode = mode
  }

  get authMode(): AuthMode {
    return this.mode
  }

  private headers(mode: AuthMode, json: boolean): Record<string, string> {
    const auth: Record<string, string> =
      mode === 'basic'
        ? { Authorization: `Basic ${this.settings.basic}` }
        : { 'x-auth-user': this.settings.username, 'x-auth-key': this.settings.koKey }
    return {
      Accept: 'application/vnd.koreader.v1+json',
      ...(json ? { 'Content-Type': 'application/json' } : ({} as Record<string, string>)),
      ...auth,
    }
  }

  private async send(mode: AuthMode, path: string, body?: unknown): Promise<Response> {
    try {
      return await fetchWithTimeout(new URL(`kosync/${path}`, this.settings.url).href, {
        method: body === undefined ? 'GET' : 'PUT',
        headers: this.headers(mode, body !== undefined),
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    } catch {
      throw new KosyncError('Sync server unreachable.', 'network')
    }
  }

  // Tries the current auth mode, then the other one once on 401.
  private async request(path: string, body?: unknown): Promise<Response> {
    let res = await this.send(this.mode, path, body)
    if (res.status === 401) {
      const other: AuthMode = this.mode === 'basic' ? 'key' : 'basic'
      const retry = await this.send(other, path, body)
      if (retry.status !== 401) {
        this.mode = other
        res = retry
      }
    }
    if (res.status === 401 || res.status === 403) throw new KosyncError('Sync login rejected.', 'auth')
    return res
  }

  async authorize(): Promise<void> {
    const res = await this.request('users/auth')
    if (!res.ok) throw new KosyncError(`Sync server answered ${res.status}.`, 'http')
  }

  async getProgress(document: string): Promise<RemoteProgress | null> {
    const res = await this.request(`syncs/progress/${document}`)
    if (res.status === 404) return null
    if (!res.ok) throw new KosyncError(`Sync server answered ${res.status}.`, 'http')
    const data = (await res.json()) as RemoteProgress
    const hasPosition = (typeof data.progress === 'string' && data.progress !== '') || Number.isFinite(data.percentage)
    return hasPosition ? data : null
  }

  async putProgress(update: ProgressUpdate): Promise<void> {
    const res = await this.request('syncs/progress', update)
    if (!res.ok) throw new KosyncError(`Sync server answered ${res.status}.`, 'http')
  }
}
