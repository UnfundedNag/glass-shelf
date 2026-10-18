// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadEpub } from '../src/epub/book'
import { ago } from '../src/glasses/app'
import { READER_BOX } from '../src/glasses/render'
import { KosyncClient, KosyncError, type ProgressUpdate } from '../src/kosync/client'
import { Reader } from '../src/reader/reader'
import type { KeyValue } from '../src/store/settings'
import { makeSettings } from '../src/store/settings'
import { PUSH_DELAY_MS, proposeJump, retryPending, SyncSession } from '../src/sync/session'
import { LOREM, makeEpub } from './helpers/epub'

const chapter = (n: number) => Array.from({ length: n }, (_, i) => `<p>${i} ${LOREM}</p>`).join('')
const reader = async () =>
  new Reader(await loadEpub(await makeEpub({ chapters: [chapter(10), `<div>${chapter(10)}</div>`, chapter(10)] })), READER_BOX)
const memoryKv = (): KeyValue & { map: Map<string, string> } => {
  const map = new Map<string, string>()
  return { map, get: async k => map.get(k) ?? '', set: async (k, v) => map.set(k, v) }
}

describe('proposeJump', () => {
  it('offers a paragraph-precise jump to a position further on from another device', async () => {
    const r = await reader()
    const jump = proposeJump(r, { progress: '/body/DocFragment[2]/body/div/p[4]/text().12', percentage: 0.4, device_id: 'other' }, 'me')
    expect(jump).toMatchObject({ precision: 'paragraph', target: { spineIndex: 1 } })
    // Proposing does not move the reader.
    expect(r.position()).toMatchObject({ spineIndex: 0, block: 0, offset: 0 })
    // The target is the start of the page that holds paragraph 4.
    r.seek(jump!.target)
    expect(r.view().text).toContain('3 Lorem')
  })

  it('ignores its own pushes, positions behind, and the page it is already on', async () => {
    const r = await reader()
    for (let i = 0; i < 20; i++) r.next()
    const here = r.position()
    const xp = (block: number) => `/body/DocFragment[${here.spineIndex + 1}]/body/div/p[${block + 1}]`
    expect(proposeJump(r, { progress: '/body/DocFragment[3]/body/p[2]', percentage: 0.9, device_id: 'me' }, 'me')).toBeNull()
    expect(proposeJump(r, { progress: '/body/DocFragment[1]/body/p[2]', percentage: 0.01, device_id: 'x' }, 'me')).toBeNull()
    expect(proposeJump(r, { progress: xp(here.block), percentage: here.percentage, device_id: 'x' }, 'me')).toBeNull()
  })

  it('falls back to the percentage within the chapter, then to the percentage alone', async () => {
    const r = await reader()
    const chapterJump = proposeJump(r, { progress: '/body/DocFragment[3]/body/nav/p', percentage: 0.1, device_id: 'x' }, 'me')
    expect(chapterJump).toMatchObject({ precision: 'chapter', target: { spineIndex: 2 } })
    const pctJump = proposeJump(r, { progress: 'page 12', percentage: 0.5, device_id: 'x' }, 'me')
    expect(pctJump?.precision).toBe('percentage')
    expect(pctJump!.target.percentage).toBeGreaterThan(0.45)
    expect(pctJump!.target.percentage).toBeLessThan(0.55)
  })
})

describe('SyncSession', () => {
  afterEach(() => vi.useRealTimers())

  async function session(put: (u: ProgressUpdate) => Promise<void>) {
    const r = await reader()
    const client = new KosyncClient(makeSettings('https://x.org', 'u', 'p'))
    client.putProgress = vi.fn(put)
    const kv = memoryKv()
    const events: string[] = []
    const s = new SyncSession(client, kv, 'doc1', r, 'me', e => events.push(e.kind))
    // Faked only after the book is built: JSZip uses timers internally.
    vi.useFakeTimers()
    return { r, client, kv, s, events }
  }

  it('pushes once page turns settle, as an XPointer with the percentage', async () => {
    const { r, client, s } = await session(async () => {})
    for (let i = 0; i < 12; i++) {
      r.next()
      s.schedulePush()
      await vi.advanceTimersByTimeAsync(1000)
    }
    expect(client.putProgress).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(PUSH_DELAY_MS)
    expect(client.putProgress).toHaveBeenCalledTimes(1)
    const update = vi.mocked(client.putProgress).mock.calls[0][0]
    expect(update.progress).toMatch(/^\/body\/DocFragment\[\d+\]\/body(\/[a-z0-9[\]]+)*$/)
    expect(update).toMatchObject({ document: 'doc1', device: 'Glass Shelf (G2)', device_id: 'me' })
    expect(update.percentage).toBeCloseTo(r.position().percentage, 3)
  })

  it('flushes a waiting push immediately and skips unchanged positions', async () => {
    const { r, client, s } = await session(async () => {})
    r.next()
    s.schedulePush()
    await s.flush()
    expect(client.putProgress).toHaveBeenCalledTimes(1)
    s.schedulePush()
    await s.flush()
    expect(client.putProgress).toHaveBeenCalledTimes(1)
  })

  it('keeps an update made offline and sends it later', async () => {
    const { r, client, kv, s, events } = await session(async () => {
      throw new KosyncError('offline', 'network')
    })
    r.next()
    s.schedulePush()
    await s.flush()
    expect(events).toEqual(['error'])
    expect(JSON.parse(kv.map.get('kosync:pending')!)).toHaveProperty('doc1')

    client.putProgress = vi.fn(async () => {})
    expect(await retryPending(client, kv)).toBe(1)
    expect(JSON.parse(kv.map.get('kosync:pending')!)).toEqual({})
  })
})

describe('ago', () => {
  it('formats elapsed time briefly', () => {
    const now = Date.UTC(2026, 9, 18, 12)
    expect(ago(now - 20_000, now)).toBe('just now')
    expect(ago(now - 5 * 60_000, now)).toBe('5 min ago')
    expect(ago(now - 2 * 3600_000, now)).toBe('2 h ago')
    expect(ago(now - 26 * 3600_000, now)).toBe('1 day ago')
  })
})
