// @vitest-environment jsdom
import { getTextWidth } from '@evenrealities/pretext'
import { describe, expect, it } from 'vitest'
import { loadEpub } from '../src/epub/book'
import { footerText } from '../src/glasses/footer'
import { FOOTER_WIDTH, READER_BOX } from '../src/glasses/render'
import { Reader } from '../src/reader/reader'
import { LOREM, makeEpub } from './helpers/epub'

const chapter = (n: number) => Array.from({ length: n }, (_, i) => `<p>${i} ${LOREM}</p>`).join('')

async function reader() {
  const book = await loadEpub(await makeEpub({ chapters: ['<img src="c.jpg"/>', chapter(8), '<p>Short.</p>', chapter(8)] }))
  return new Reader(book, READER_BOX)
}

describe('Reader', () => {
  it('starts at the first chapter with text', async () => {
    const r = await reader()
    expect(r.position()).toMatchObject({ spineIndex: 1, block: 0, offset: 0, percentage: 0 })
    expect(r.view()).toMatchObject({ chapter: 1, chapters: 3, atEnd: false })
  })

  it('pages through chapters to the end and back to the start', async () => {
    const r = await reader()
    const seen = [r.position()]
    while (r.next()) seen.push(r.position())
    expect(r.view().atEnd).toBe(true)
    expect(new Set(seen.map(p => p.spineIndex))).toEqual(new Set([1, 2, 3]))
    for (let i = 1; i < seen.length; i++) expect(seen[i].percentage).toBeGreaterThan(seen[i - 1].percentage)

    let back = 0
    while (r.prev()) back++
    expect(back).toBe(seen.length - 1)
    expect(r.position()).toEqual(seen[0])
  })

  it('resumes on the page containing a saved position', async () => {
    const r = await reader()
    for (let i = 0; i < 5; i++) r.next()
    const saved = r.position()
    const text = r.view().text

    const again = await reader()
    again.seek({ ...saved, offset: saved.offset + 3 })
    expect(again.view().text).toBe(text)
  })

  it('skips to the next chapter with text when the saved item has none', async () => {
    const r = await reader()
    r.seek({ spineIndex: 0, block: 0, offset: 0 })
    expect(r.position().spineIndex).toBe(1)
  })

  it("skips the book's table of contents but keeps its spine index", async () => {
    const book = await loadEpub(await makeEpub({ chapters: ['<ol><li>One</li><li>Two</li></ol>', chapter(2)], nav: 0 }))
    expect(book.chapters[0].isToc).toBe(true)
    const r = new Reader(book, READER_BOX)
    expect(r.position().spineIndex).toBe(1)
    expect(r.view().chapters).toBe(1)
    expect(r.prev()).toBe(false)
  })

  it('formats a footer that fits on one line', async () => {
    const r = await reader()
    const text = footerText(r.view(), new Date(2026, 9, 18, 9, 5), FOOTER_WIDTH)
    expect(text).toContain('Ch 1/3 · 0% · 9:05')
    expect(getTextWidth(text)).toBeLessThanOrEqual(FOOTER_WIDTH)
  })
})
