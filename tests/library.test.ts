import { describe, expect, it } from 'vitest'
import { libraryItems } from '../src/glasses/library'
import { clipBytes } from '../src/glasses/text'
import type { BookEntry } from '../src/opds/parse'

const book = (id: string, title: string, author = 'Author'): BookEntry => ({
  kind: 'book',
  id,
  title,
  author,
  epubHref: `https://x.org/${id}`,
  updated: '',
})

const bytes = (s: string) => new TextEncoder().encode(s).length

describe('clipBytes', () => {
  it('leaves short labels alone and collapses whitespace', () => {
    expect(clipBytes('  A  short\ntitle ')).toBe('A short title')
  })

  it('clips to 63 UTF-8 bytes without splitting characters', () => {
    const clipped = clipBytes('é'.repeat(40))
    expect(bytes(clipped)).toBeLessThanOrEqual(63)
    expect(clipped.endsWith('…')).toBe(true)
    expect(clipped).toBe('é'.repeat(30) + '…')
  })
})

describe('libraryItems', () => {
  const recent = Array.from({ length: 25 }, (_, i) => book(`${i}`, `Book ${i}`))

  it('caps the list at 20 items', () => {
    expect(libraryItems(recent, null)).toHaveLength(20)
  })

  it('puts the last book first as Continue and does not repeat it', () => {
    const items = libraryItems(recent, recent[3])
    expect(items[0].label).toBe('▶ Continue: Book 3')
    expect(items.filter(i => i.book.id === '3')).toHaveLength(1)
    expect(items).toHaveLength(20)
  })

  it('labels books with title and author within the byte limit', () => {
    const [item] = libraryItems([book('x', 'A Very Long Title That Goes On And On Forever', 'Someone Important')], null)
    expect(bytes(item.label)).toBeLessThanOrEqual(63)
    expect(item.label.startsWith('A Very Long Title')).toBe(true)
  })
})
