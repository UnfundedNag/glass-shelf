import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { BookCache } from '../src/store/books'
import { loadSettings, makeSettings, normalizeServerUrl, saveSettings, type KeyValue } from '../src/store/settings'

describe('normalizeServerUrl', () => {
  it('ends the URL with a slash and trims a pasted /opds', () => {
    expect(normalizeServerUrl(' https://books.example.org ')).toBe('https://books.example.org/')
    expect(normalizeServerUrl('https://books.example.org/opds')).toBe('https://books.example.org/')
    expect(normalizeServerUrl('https://example.org/calibre/opds/')).toBe('https://example.org/calibre/')
    expect(normalizeServerUrl('http://10.0.0.5:8083/calibre')).toBe('http://10.0.0.5:8083/calibre/')
  })

  it('rejects non-URLs, other schemes and embedded credentials', () => {
    expect(() => normalizeServerUrl('books.example.org')).toThrow()
    expect(() => normalizeServerUrl('ftp://books.example.org')).toThrow()
    expect(() => normalizeServerUrl('https://u:p@books.example.org')).toThrow()
  })
})

describe('makeSettings', () => {
  it('derives the Basic credential and the kosync md5 key', () => {
    const s = makeSettings('https://books.example.org', ' reader ', 'password')
    expect(s).toEqual({
      url: 'https://books.example.org/',
      username: 'reader',
      basic: btoa('reader:password'),
      koKey: '5f4dcc3b5aa765d61d8327deb882cf99', // md5("password"), a public test vector. gitleaks:allow
    })
  })

  it('encodes non-ASCII credentials as UTF-8', () => {
    expect(atob(makeSettings('https://x.org', 'zoë', 'pässword').basic)).toBe('zoÃ«:pÃ¤ssword')
  })

  it('round-trips through key-value storage', async () => {
    const map = new Map<string, string>()
    // The bridge returns an empty string for missing keys.
    const kv: KeyValue = { get: async k => map.get(k) ?? '', set: async (k, v) => map.set(k, v) }
    expect(await loadSettings(kv)).toBeNull()
    const s = makeSettings('https://x.org', 'a', 'b')
    await saveSettings(kv, s)
    expect(await loadSettings(kv)).toEqual(s)
  })
})

describe('BookCache', () => {
  it('keeps only the most recently opened books', async () => {
    let t = 0
    const cache = new BookCache(3, () => ++t)
    const bytes = (n: number) => new Uint8Array([n]).buffer
    await cache.put('a', bytes(1))
    await cache.put('b', bytes(2))
    await cache.put('c', bytes(3))
    expect(new Uint8Array((await cache.get('a'))!)).toEqual(new Uint8Array([1]))
    await cache.put('d', bytes(4))
    expect((await cache.ids()).sort()).toEqual(['a', 'c', 'd'])
    expect(await cache.get('b')).toBeNull()
  })
})
