// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OpdsClient, OpdsError } from '../src/opds/client'
import { parseFeed } from '../src/opds/parse'
import newPage1 from './fixtures/new-page1.xml?raw'
import newPage2 from './fixtures/new-page2.xml?raw'
import root from './fixtures/root.xml?raw'

const fixtures: Record<string, string> = { 'new-page1.xml': newPage1, 'new-page2.xml': newPage2, 'root.xml': root }
const fixture = (name: string) => fixtures[name]
const BASE = 'https://books.example.org/calibre/'

describe('parseFeed', () => {
  const feed = parseFeed(fixture('new-page1.xml'), `${BASE}opds/new`)

  it('reads books with their plain EPUB link, not the kepub', () => {
    expect(feed.entries[0]).toEqual({
      kind: 'book',
      id: 'urn:uuid:11111111-1111-1111-1111-111111111111',
      title: 'A Wizard of Earthsea',
      author: 'Ursula K. Le Guin',
      epubHref: 'https://books.example.org/opds/download/1/epub/',
      updated: '2026-10-01T10:00:00+00:00',
    })
  })

  it('joins multiple authors and skips books without an EPUB', () => {
    expect(feed.entries.map(e => e.title)).toEqual(['A Wizard of Earthsea', 'Good Omens'])
    expect(feed.entries[1]).toMatchObject({ author: 'Terry Pratchett, Neil Gaiman' })
  })

  it("restores the comma Calibre stores as '|' in author names", () => {
    const page2 = parseFeed(fixture('new-page2.xml'), `${BASE}opds/new`)
    expect(page2.entries[1]).toMatchObject({ title: 'Ready Player One', author: 'Cline, Ernest' })
  })

  it('reads pagination and the Atom search template', () => {
    expect(feed.title).toBe('Test Library')
    expect(feed.next).toBe('https://books.example.org/opds/new?offset=3')
    expect(feed.searchTemplate).toBe('/opds/search/{searchTerms}')
  })

  it('reads navigation entries', () => {
    const root = parseFeed(fixture('root.xml'), `${BASE}opds`)
    expect(root.entries).toEqual([
      { kind: 'nav', id: '/opds/new', title: 'Recently Added Books', href: 'https://books.example.org/opds/new' },
    ])
  })

  it('rejects documents that are not Atom feeds', () => {
    expect(() => parseFeed('<html><body>Login</body></html>', BASE)).toThrow()
  })
})

describe('OpdsClient', () => {
  afterEach(() => vi.unstubAllGlobals())

  function stubFetch(routes: Record<string, string | number>) {
    const calls: { url: string; auth: string | null }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, auth: new Headers(init?.headers).get('Authorization') })
        const body = routes[url]
        if (body === undefined) return new Response('not found', { status: 404 })
        if (typeof body === 'number') return new Response('', { status: body })
        return new Response(body, { status: 200 })
      }),
    )
    return calls
  }

  const client = new OpdsClient({ url: 'https://books.example.org/', basic: 'dXNlcjpwdw==' })

  it('follows pagination with Basic auth until the limit', async () => {
    const calls = stubFetch({
      'https://books.example.org/opds/new': fixture('new-page1.xml'),
      'https://books.example.org/opds/new?offset=3': fixture('new-page2.xml'),
    })
    const books = await client.recentBooks(3)
    expect(books.map(b => b.title)).toEqual(['A Wizard of Earthsea', 'Good Omens', 'The Left Hand of Darkness'])
    expect(calls.every(c => c.auth === 'Basic dXNlcjpwdw==')).toBe(true)
  })

  it('stops at the limit without fetching more pages', async () => {
    const calls = stubFetch({ 'https://books.example.org/opds/new': fixture('new-page1.xml') })
    expect(await client.recentBooks(1)).toHaveLength(1)
    expect(calls).toHaveLength(1)
  })

  it('searches through the server template with the query encoded', async () => {
    stubFetch({
      'https://books.example.org/opds': fixture('root.xml'),
      'https://books.example.org/opds/search/le%20guin%2Fdark': fixture('new-page2.xml'),
    })
    expect((await client.search('le guin/dark')).map(b => b.title)).toEqual(['The Left Hand of Darkness', 'Ready Player One'])
  })

  it('reports rejected credentials, server errors and network failures distinctly', async () => {
    stubFetch({ 'https://books.example.org/opds': 401 })
    await expect(client.root()).rejects.toMatchObject({ kind: 'auth' })
    stubFetch({ 'https://books.example.org/opds': 502 })
    await expect(client.root()).rejects.toMatchObject({ kind: 'http' })
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))))
    await expect(client.root()).rejects.toBeInstanceOf(OpdsError)
    await expect(client.root()).rejects.toMatchObject({ kind: 'network' })
  })

  it('reports an HTML login page as a format error', async () => {
    stubFetch({ 'https://books.example.org/opds': '<html><body>Login</body></html>' })
    await expect(client.root()).rejects.toMatchObject({ kind: 'format' })
  })
})
