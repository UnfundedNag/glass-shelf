// Runs under Node (jsdom's timers break Node's fetch), borrowing jsdom's XML
// parser for the OPDS and EPUB code.
import { JSDOM } from 'jsdom'
// Opt-in checks against a real Calibre-Web server: `npm run test:live` with
// VITE_DEV_SERVER_URL / _USER / _PASSWORD in .env.local. Node skips CORS, so
// this tests the server and parser, not the WebView's CORS path.
import { describe, expect, it } from 'vitest'
import { measureTextWrap } from '@evenrealities/pretext'
import { loadEpub } from '../src/epub/book'
import { READER_BOX } from '../src/glasses/render'
import { OpdsClient } from '../src/opds/client'
import { Reader } from '../src/reader/reader'
import { makeSettings } from '../src/store/settings'

const { window } = new JSDOM()
Object.assign(globalThis, { DOMParser: window.DOMParser, Node: window.Node })

const env = import.meta.env
const live = env.LIVE === '1' && !!env.VITE_DEV_SERVER_URL

describe.skipIf(!live)('live Calibre-Web', () => {
  const client = () =>
    new OpdsClient(makeSettings(env.VITE_DEV_SERVER_URL, env.VITE_DEV_SERVER_USER ?? '', env.VITE_DEV_SERVER_PASSWORD ?? ''))

  it('serves an OPDS root with a search template', async () => {
    const root = await client().root()
    expect(root.entries.length).toBeGreaterThan(0)
    expect(root.searchTemplate).toContain('{searchTerms}')
  })

  it('lists recent books with plain EPUB links', async () => {
    const books = await client().recentBooks(20)
    expect(books.length).toBeGreaterThan(0)
    for (const b of books) {
      expect(b.title).not.toBe('')
      expect(b.epubHref).toMatch(/\/epub\/?$/)
    }
  })

  it('finds a recent book by searching for its title', async () => {
    const [book] = await client().recentBooks(1)
    const word = book.title.split(/\s+/).sort((a, b) => b.length - a.length)[0]
    const found = await client().search(word)
    expect(found.map(b => b.id)).toContain(book.id)
  })

  it('downloads an EPUB (zip bytes)', async () => {
    const [book] = await client().recentBooks(1)
    const bytes = new Uint8Array(await client().download(book))
    expect([...bytes.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04])
  }, 60_000)

  it('opens and paginates every recent book without overflowing a page', async () => {
    for (const entry of await client().recentBooks(20)) {
      const started = performance.now()
      const book = await loadEpub(await client().download(entry))
      const reader = new Reader(book, READER_BOX)
      let pages = 1
      expect(measureTextWrap(reader.view().text, READER_BOX.width).lineCount).toBeLessThanOrEqual(9)
      while (reader.next()) {
        pages++
        expect(measureTextWrap(reader.view().text, READER_BOX.width).lineCount).toBeLessThanOrEqual(9)
      }
      const seconds = ((performance.now() - started) / 1000).toFixed(1)
      console.log(`${entry.title}: ${book.chapters.length} spine items, ${pages} pages, ${seconds}s`)
    }
  }, 600_000)

  it('rejects a wrong password as an auth error', async () => {
    const bad = new OpdsClient(makeSettings(env.VITE_DEV_SERVER_URL, env.VITE_DEV_SERVER_USER ?? '', 'definitely-wrong'))
    await expect(bad.root()).rejects.toMatchObject({ kind: 'auth' })
  })
})
