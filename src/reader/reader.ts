import type { Book } from '../epub/book'
import { pageAt, paginate, type Box, type Page } from '../paginate/paginate'

// Where the reader is, in the SPEC §5 position model.
export type Position = {
  spineIndex: number
  block: number
  offset: number
  // 0..1 through the whole book, by characters before the position.
  percentage: number
}

export type View = {
  text: string
  // 1-based among chapters that have text, for the footer.
  chapter: number
  chapters: number
  percentage: number
  atEnd: boolean
}

export class Reader {
  private readonly pages = new Map<number, Page[]>()
  // Chapters (by index into book.chapters) to read: those with text, minus
  // the table of contents.
  private readonly readable: number[]
  private chapter: number
  private page = 0

  constructor(
    private readonly book: Book,
    private readonly box: Box,
  ) {
    const readable = (skipToc: boolean) => book.chapters.flatMap((c, i) => (c.chars > 0 && !(skipToc && c.isToc) ? [i] : []))
    this.readable = readable(true).length ? readable(true) : readable(false)
    this.chapter = this.readable[0]
  }

  private pagesOf(chapter: number): Page[] {
    let pages = this.pages.get(chapter)
    if (!pages) {
      pages = paginate(this.book.chapters[chapter].blocks, this.box)
      this.pages.set(chapter, pages)
    }
    return pages
  }

  // Moves to the page containing `pos`, or the start for an unknown spine item.
  seek(pos: Pick<Position, 'spineIndex' | 'block' | 'offset'>): void {
    const chapter = this.book.chapters.findIndex(c => c.spineIndex === pos.spineIndex)
    if (!this.readable.includes(chapter)) {
      // Covers, image-only items and the contents page: start at the next
      // chapter to read.
      this.chapter = this.readable.find(i => i > chapter) ?? this.readable[0]
      this.page = 0
      return
    }
    this.chapter = chapter
    this.page = pageAt(this.pagesOf(chapter), { block: pos.block, offset: pos.offset })
  }

  // Moves to a fraction of the whole book. With `spineIndex`, the result is
  // clamped into that chapter (SPEC §5 ladder step 3: right chapter, best guess
  // within it).
  seekPercentage(percentage: number, spineIndex?: number): void {
    let target = Math.max(0, Math.min(1, percentage)) * this.book.totalChars
    const clampTo = spineIndex === undefined ? -1 : this.book.chapters.findIndex(c => c.spineIndex === spineIndex)
    if (this.readable.includes(clampTo)) {
      const start = this.charsBefore(clampTo)
      target = Math.max(start, Math.min(start + this.book.chapters[clampTo].chars - 1, target))
    }
    for (const i of this.readable) {
      const chapter = this.book.chapters[i]
      const start = this.charsBefore(i)
      if (target < start + chapter.chars || i === this.readable.at(-1)) {
        let remaining = Math.max(0, target - start)
        let block = 0
        while (block < chapter.blocks.length - 1 && remaining >= chapter.blocks[block].text.length) {
          remaining -= chapter.blocks[block].text.length
          block++
        }
        return this.seek({ spineIndex: chapter.spineIndex, block, offset: Math.floor(remaining) })
      }
    }
  }

  private charsBefore(chapter: number): number {
    let n = 0
    for (const c of this.book.chapters.slice(0, chapter)) n += c.chars
    return n
  }

  // Blocks of a spine item, for resolving remote positions.
  blocksOf(spineIndex: number) {
    return this.book.chapters.find(c => c.spineIndex === spineIndex)?.blocks ?? null
  }

  // Path of the block a position is in, for building the sync XPointer.
  blockPath(position: Position): string {
    const chapter = this.book.chapters.find(c => c.spineIndex === position.spineIndex)
    return chapter?.blocks[position.block]?.path ?? '/body'
  }

  next(): boolean {
    if (this.page < this.pagesOf(this.chapter).length - 1) {
      this.page++
      return true
    }
    const following = this.readable[this.readable.indexOf(this.chapter) + 1]
    if (following === undefined) return false
    this.chapter = following
    this.page = 0
    return true
  }

  prev(): boolean {
    if (this.page > 0) {
      this.page--
      return true
    }
    const preceding = this.readable[this.readable.indexOf(this.chapter) - 1]
    if (preceding === undefined) return false
    this.chapter = preceding
    this.page = this.pagesOf(preceding).length - 1
    return true
  }

  position(): Position {
    const chapter = this.book.chapters[this.chapter]
    const { block, offset } = this.pagesOf(this.chapter)[this.page].start
    let before = offset + this.charsBefore(this.chapter)
    for (const b of chapter.blocks.slice(0, block)) before += b.text.length
    return { spineIndex: chapter.spineIndex, block, offset, percentage: before / this.book.totalChars }
  }

  view(): View {
    const pages = this.pagesOf(this.chapter)
    const index = this.readable.indexOf(this.chapter)
    return {
      text: pages[this.page].text,
      chapter: index + 1,
      chapters: this.readable.length,
      percentage: this.position().percentage,
      atEnd: index === this.readable.length - 1 && this.page === pages.length - 1,
    }
  }
}
