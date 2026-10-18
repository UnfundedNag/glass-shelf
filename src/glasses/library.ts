import type { BookEntry } from '../opds/parse'
import { clipBytes } from './text'

export const MAX_ITEMS = 20

export type LibraryItem = { label: string; book: BookEntry }

// "▶ Continue: <last book>" first (when there is one), then recent books,
// skipping the continued book so it is not listed twice.
export function libraryItems(recent: BookEntry[], last: BookEntry | null): LibraryItem[] {
  const items: LibraryItem[] = []
  if (last) items.push({ label: clipBytes(`▶ Continue: ${last.title}`), book: last })
  for (const book of recent) {
    if (items.length >= MAX_ITEMS) break
    if (book.id === last?.id) continue
    const label = book.author ? `${book.title} · ${book.author}` : book.title
    items.push({ label: clipBytes(label), book })
  }
  return items
}
