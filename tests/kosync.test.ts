// @vitest-environment jsdom
import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { KosyncClient } from '../src/kosync/client'
import { koPartialMd5 } from '../src/kosync/hash'
import { blockForPath, buildXPointer, parseXPointer } from '../src/kosync/xpointer'
import { makeSettings } from '../src/store/settings'

// Straight transcription of KOReader's util.partialMD5 loop, with Node's MD5,
// as an independent check of the SparkMD5 version.
function referencePartialMd5(bytes: Uint8Array): string {
  const md5 = createHash('md5')
  for (let i = -1; i <= 10; i++) {
    const offset = i < 0 ? 0 : 1024 * 4 ** i // lshift(1024, -2) wraps to 0
    if (offset >= bytes.length) break
    md5.update(bytes.subarray(offset, offset + 1024))
  }
  return md5.digest('hex')
}

describe('koPartialMd5', () => {
  it.each([0, 1, 500, 1024, 1025, 4096, 5000, 70_000, 2_000_000])('matches KOReader for %i bytes', size => {
    const bytes = Uint8Array.from({ length: size }, (_, i) => (i * 7919 + (i >> 8)) & 0xff)
    expect(koPartialMd5(bytes.buffer)).toBe(referencePartialMd5(bytes))
  })

  it('samples only the first KB of a small file', () => {
    const a = new Uint8Array(900).fill(1)
    const b = new Uint8Array(900).fill(1)
    b[899] = 2
    expect(koPartialMd5(a.buffer)).not.toBe(koPartialMd5(b.buffer))
  })
})

describe('xpointers', () => {
  it('builds DocFragment paths from spine index and block path', () => {
    expect(buildXPointer(6, '/body/div/p[3]')).toBe('/body/DocFragment[7]/body/div/p[3]')
  })

  it.each([
    ['/body/DocFragment[12]/body/div/p[3]/text().45', 11, '/body/div/p[3]'],
    ['/body/DocFragment[12]/body/div/p[3]/text()[2].5', 11, '/body/div/p[3]'],
    ['/body/DocFragment[3]/body/div[2].0', 2, '/body/div[2]'],
    ['/body/DocFragment[3]/body/section/p', 2, '/body/section/p'],
    ['/body/DocFragment/body/p[9]/text().0', 0, '/body/p[9]'],
    ['/body/DocFragment[5]', 4, '/body'],
  ])('parses %s', (xp, spineIndex, elementPath) => {
    expect(parseXPointer(xp)).toEqual({ spineIndex, elementPath })
  })

  it('rejects positions that are not XPointers', () => {
    expect(parseXPointer('42')).toBeNull()
    expect(parseXPointer('epubcfi(/6/4!/4/2)')).toBeNull()
  })

  const blocks = ['/body/h1', '/body/div', '/body/div/p[1]', '/body/div/p[2]', '/body/section/p'].map(path => ({ path, text: 'x' }))

  it('resolves element paths to blocks', () => {
    expect(blockForPath(blocks, '/body/div/p[2]')).toBe(3)
    // An inline element inside a paragraph lands on the paragraph.
    expect(blockForPath(blocks, '/body/div/p[2]/span[3]')).toBe(3)
    // A wrapper lands on its first block.
    expect(blockForPath(blocks, '/body/section')).toBe(4)
    // [1] and no index both mean the first of that name.
    expect(blockForPath(blocks, '/body/section[1]/p[1]')).toBe(4)
    expect(blockForPath(blocks, '/body/aside/p')).toBeNull()
  })
})

describe('KosyncClient', () => {
  afterEach(() => vi.unstubAllGlobals())
  const settings = makeSettings('https://books.example.org/', 'reader', 'secret')

  function stub(handler: (url: string, init: RequestInit) => Response) {
    const calls: { url: string; init: RequestInit }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, init })
        return handler(url, init)
      }),
    )
    return calls
  }
  const header = (init: RequestInit, name: string) => new Headers(init.headers).get(name)

  it('logs in with HTTP Basic first', async () => {
    const calls = stub(() => Response.json({ authorized: 'OK' }))
    await new KosyncClient(settings).authorize()
    expect(calls[0].url).toBe('https://books.example.org/kosync/users/auth')
    expect(header(calls[0].init, 'Authorization')).toBe(`Basic ${btoa('reader:secret')}`)
    expect(header(calls[0].init, 'Accept')).toBe('application/vnd.koreader.v1+json')
  })

  it('falls back to the md5 key headers when Basic is rejected, and keeps using them', async () => {
    const calls = stub((_, init) =>
      header(init, 'x-auth-key') ? Response.json({ authorized: 'OK' }) : new Response('', { status: 401 }),
    )
    const client = new KosyncClient(settings)
    await client.authorize()
    expect(client.authMode).toBe('key')
    expect(header(calls[1].init, 'x-auth-user')).toBe('reader')
    expect(header(calls[1].init, 'x-auth-key')).toBe(settings.koKey)
    await client.authorize()
    expect(calls).toHaveLength(3)
  })

  it('reports a login both methods reject', async () => {
    stub(() => new Response('', { status: 401 }))
    await expect(new KosyncClient(settings).authorize()).rejects.toMatchObject({ kind: 'auth' })
  })

  it('treats an empty record or 404 as no position', async () => {
    stub(() => Response.json({}))
    expect(await new KosyncClient(settings).getProgress('abc')).toBeNull()
    stub(() => new Response('', { status: 404 }))
    expect(await new KosyncClient(settings).getProgress('abc')).toBeNull()
  })

  it('pushes progress as JSON with PUT', async () => {
    const calls = stub(() => Response.json({ document: 'abc', timestamp: 1 }))
    const update = { document: 'abc', progress: '/body/DocFragment[2]/body/p', percentage: 0.25, device: 'd', device_id: 'i' }
    await new KosyncClient(settings).putProgress(update)
    expect(calls[0].url).toBe('https://books.example.org/kosync/syncs/progress')
    expect(calls[0].init.method).toBe('PUT')
    expect(JSON.parse(calls[0].init.body as string)).toEqual(update)
  })

  it('reports network failures as such', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))))
    await expect(new KosyncClient(settings).getProgress('abc')).rejects.toMatchObject({ kind: 'network' })
  })
})
