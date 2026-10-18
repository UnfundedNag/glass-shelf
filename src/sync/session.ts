import { KosyncError, type KosyncClient, type ProgressUpdate, type RemoteProgress } from '../kosync/client'
import { locate, parseXPointer } from '../kosync/xpointer'
import type { Position, Reader } from '../reader/reader'
import type { KeyValue } from '../store/settings'

export const PUSH_DELAY_MS = 10_000
export const DEVICE_NAME = 'Glass Shelf (G2)'

const DEVICE_ID = 'kosync:deviceId'
const PENDING = 'kosync:pending'

export type SyncEvent =
  | { kind: 'pushed'; percentage: number }
  | { kind: 'pulled'; remote: RemoteProgress | null }
  | { kind: 'error'; message: string }

export type Jump = {
  remote: RemoteProgress
  target: Position
  // How precisely the remote position resolved (SPEC §5 ladder): the exact
  // character, the start of its paragraph, its chapter, or the percentage.
  precision: 'exact' | 'paragraph' | 'chapter' | 'percentage'
}

// A stable random id for this install; KOReader uses it to tell devices apart.
export async function deviceId(kv: KeyValue): Promise<string> {
  const existing = await kv.get(DEVICE_ID)
  if (existing) return existing
  // getRandomValues works on plain-HTTP dev servers; randomUUID does not.
  const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('')
  await kv.set(DEVICE_ID, id)
  return id
}

// Moves `reader` to a remote position, as precisely as it resolves.
export function applyRemote(reader: Reader, remote: RemoteProgress): Jump['precision'] | null {
  const parsed = remote.progress ? parseXPointer(remote.progress) : null
  const percentage = Number.isFinite(remote.percentage) ? remote.percentage! : null
  if (parsed) {
    const blocks = reader.blocksOf(parsed.spineIndex)
    const found = blocks ? locate(blocks, parsed) : null
    if (found) {
      reader.seek({ spineIndex: parsed.spineIndex, block: found.block, offset: found.offset })
      return found.exact ? 'exact' : 'paragraph'
    }
    if (blocks && percentage !== null) {
      reader.seekPercentage(percentage, parsed.spineIndex)
      return 'chapter'
    }
    if (blocks) {
      reader.seek({ spineIndex: parsed.spineIndex, block: 0, offset: 0 })
      return 'chapter'
    }
  }
  if (percentage === null) return null
  reader.seekPercentage(percentage)
  return 'percentage'
}

// Whether to offer jumping to a remote position: only when it comes from
// another device and lands further on than where the reader is now.
export function proposeJump(reader: Reader, remote: RemoteProgress | null, me: string): Jump | null {
  if (!remote || remote.device_id === me) return null
  // position() is the start of the current page, so equal positions mean the
  // same page: another device that opened where we left off is not a jump.
  const here = reader.position()
  const precision = applyRemote(reader, remote)
  const target = reader.position()
  reader.seek(here)
  if (!precision || target.percentage <= here.percentage) return null
  return { remote, target, precision }
}

// Syncs one open book: pull once on open, push after page turns settle.
export class SyncSession {
  private timer: ReturnType<typeof setTimeout> | null = null
  private lastSent: string | null = null

  constructor(
    private readonly client: KosyncClient,
    private readonly kv: KeyValue,
    private readonly document: string,
    private readonly reader: Reader,
    private readonly device: string,
    private readonly onEvent: (e: SyncEvent) => void,
  ) {}

  async pull(): Promise<Jump | null> {
    try {
      const remote = await this.client.getProgress(this.document)
      this.onEvent({ kind: 'pulled', remote })
      return proposeJump(this.reader, remote, this.device)
    } catch (err) {
      this.onEvent({ kind: 'error', message: (err as Error).message })
      return null
    }
  }

  // After accepting a remote position there is nothing new to push.
  markSynced(): void {
    this.lastSent = this.signature(this.update())
  }

  schedulePush(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.push(), PUSH_DELAY_MS)
  }

  // Pushes now if a push is waiting (leaving the book, app backgrounded).
  async flush(): Promise<void> {
    if (!this.timer) return
    clearTimeout(this.timer)
    await this.push()
  }

  private update(): ProgressUpdate {
    const position = this.reader.position()
    return {
      document: this.document,
      progress: this.reader.xpointer(position),
      percentage: Math.round(position.percentage * 10000) / 10000,
      device: DEVICE_NAME,
      device_id: this.device,
    }
  }

  private signature(u: ProgressUpdate): string {
    return `${u.progress}|${u.percentage}`
  }

  private async push(): Promise<void> {
    this.timer = null
    const update = this.update()
    if (this.signature(update) === this.lastSent) return
    try {
      await this.client.putProgress(update)
      this.lastSent = this.signature(update)
      await clearPending(this.kv, this.document)
      this.onEvent({ kind: 'pushed', percentage: update.percentage })
    } catch (err) {
      // Offline: keep the latest update and retry on the next sync.
      if (err instanceof KosyncError && err.kind === 'network') await savePending(this.kv, update)
      this.onEvent({ kind: 'error', message: (err as Error).message })
    }
  }
}

async function readPending(kv: KeyValue): Promise<Record<string, ProgressUpdate>> {
  try {
    return JSON.parse((await kv.get(PENDING)) || '{}') as Record<string, ProgressUpdate>
  } catch {
    return {}
  }
}

async function savePending(kv: KeyValue, update: ProgressUpdate): Promise<void> {
  const pending = await readPending(kv)
  pending[update.document] = update
  await kv.set(PENDING, JSON.stringify(pending))
}

async function clearPending(kv: KeyValue, document: string): Promise<void> {
  const pending = await readPending(kv)
  if (!(document in pending)) return
  delete pending[document]
  await kv.set(PENDING, JSON.stringify(pending))
}

// Sends updates that failed while offline. Stops at the first network failure.
export async function retryPending(client: KosyncClient, kv: KeyValue): Promise<number> {
  let sent = 0
  for (const update of Object.values(await readPending(kv))) {
    try {
      await client.putProgress(update)
      await clearPending(kv, update.document)
      sent++
    } catch (err) {
      if (err instanceof KosyncError && err.kind === 'network') break
      // Rejected (e.g. auth): drop it rather than retry forever.
      await clearPending(kv, update.document)
    }
  }
  return sent
}
