import { measureTextWrap } from '@evenrealities/pretext'
import { describe, expect, it } from 'vitest'
import type { Block } from '../src/epub/blocks'
import { INDENT, LINE_HEIGHT, pageAt, paginate } from '../src/paginate/paginate'
import { READER_BOX } from '../src/glasses/render'
import { LOREM } from './helpers/epub'

const blocks = (...texts: string[]): Block[] => texts.map((text, i) => ({ path: `/body/p[${i + 1}]`, text, sources: [] }))
// Rebuilds the source text from pages, to check nothing is lost or repeated.
const flatten = (texts: string[]) => texts.join(' ').replaceAll(INDENT, '').replace(/\s+/g, ' ').trim()

describe('paginate (real G2 measurements)', () => {
  const source = blocks(...Array.from({ length: 30 }, (_, i) => `${i}. ${LOREM.slice(0, 40 + ((i * 37) % 180))}`))
  const pages = paginate(source, READER_BOX)
  const maxLines = Math.floor(READER_BOX.height / LINE_HEIGHT)

  it('never overflows the body container', () => {
    expect(maxLines).toBe(9)
    for (const page of pages) expect(measureTextWrap(page.text, READER_BOX.width).lineCount).toBeLessThanOrEqual(maxLines)
  })

  it('fills pages: every page but the last uses the full height', () => {
    for (const page of pages.slice(0, -1)) {
      expect(measureTextWrap(page.text, READER_BOX.width).lineCount).toBeGreaterThanOrEqual(maxLines - 1)
    }
  })

  it('keeps every word exactly once, in order', () => {
    expect(flatten(pages.map(p => p.text))).toBe(flatten(source.map(b => b.text)))
  })

  it('records where each page starts', () => {
    expect(pages[0].start).toEqual({ block: 0, offset: 0 })
    for (const page of pages.slice(1)) {
      const { block, offset } = page.start
      const rest = source[block].text.slice(offset)
      expect(page.text.replace(INDENT, '').startsWith(rest.slice(0, 10))).toBe(true)
    }
  })
})

describe('paginate (edge cases)', () => {
  // 10 characters per line, 2 lines per page, for readable expectations.
  const measure = (text: string, width: number) => ({
    lineCount: text.split('\n').reduce((n, line) => n + Math.max(1, Math.ceil(line.length / width)), 0),
  })
  const box = { width: 10, height: 2 * LINE_HEIGHT }

  it('splits a paragraph at word boundaries and continues without an indent', () => {
    const pages = paginate(blocks('aaaa bbbb cccc dddd eeee ffff gggg'), box, measure)
    expect(pages.map(p => p.text)).toEqual([`${INDENT}aaaa bbbb cccc dddd`, 'eeee ffff gggg'])
    expect(pages.map(p => p.start)).toEqual([
      { block: 0, offset: 0 },
      { block: 0, offset: 20 },
    ])
  })

  it('starts the next paragraph on a new line with an indent', () => {
    const pages = paginate(blocks('aaaa', 'bbbb', 'cccc'), box, measure)
    expect(pages.map(p => p.text)).toEqual([`${INDENT}aaaa\n${INDENT}bbbb`, `${INDENT}cccc`])
    expect(pages[1].start).toEqual({ block: 2, offset: 0 })
  })

  it('splits a word longer than a page by characters', () => {
    const pages = paginate(blocks('x'.repeat(45)), box, measure)
    expect(pages.map(p => p.text.replace(INDENT, '')).join('')).toBe('x'.repeat(45))
    for (const p of pages) expect(measure(p.text, 10).lineCount).toBeLessThanOrEqual(2)
  })

  it('returns no pages for no blocks', () => {
    expect(paginate([], box, measure)).toEqual([])
  })
})

describe('pageAt', () => {
  const pages = [
    { start: { block: 0, offset: 0 }, text: '' },
    { start: { block: 0, offset: 50 }, text: '' },
    { start: { block: 2, offset: 0 }, text: '' },
  ]
  it('finds the page containing a position', () => {
    expect(pageAt(pages, { block: 0, offset: 49 })).toBe(0)
    expect(pageAt(pages, { block: 0, offset: 50 })).toBe(1)
    expect(pageAt(pages, { block: 1, offset: 999 })).toBe(1)
    expect(pageAt(pages, { block: 9, offset: 0 })).toBe(2)
  })
})
