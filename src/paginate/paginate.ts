import { measureTextWrap } from '@evenrealities/pretext'
import type { Block } from '../epub/blocks'

// LVGL's line height on the G2 is fixed.
export const LINE_HEIGHT = 27
// rebuildPageContainer takes at most 1000 characters per text container.
export const MAX_PAGE_CHARS = 1000
// Paragraphs start on a new line with a fullwidth-space indent rather than a
// blank line, which would cost one of only ~9 lines per page.
export const INDENT = '\u3000'

// A point in a chapter: block index and character offset into its text.
export type ChapterPos = { block: number; offset: number }
export type Page = { start: ChapterPos; text: string }
export type Box = { width: number; height: number }
export type Measure = (text: string, width: number) => { lineCount: number }

export function comparePos(a: ChapterPos, b: ChapterPos): number {
  return a.block - b.block || a.offset - b.offset
}

// Offsets in `s` where a line may break: after each whitespace run, and the end.
function breakPoints(s: string): number[] {
  const points: number[] = []
  for (let i = 1; i < s.length; i++) if (/\s/.test(s[i - 1]) && !/\s/.test(s[i])) points.push(i)
  points.push(s.length)
  return points
}

// Largest index into `candidates` (ascending) for which `fits` holds, or -1.
function lastFitting(candidates: number[], fits: (n: number) => boolean): number {
  let lo = 0
  let hi = candidates.length - 1
  let best = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (fits(candidates[mid])) {
      best = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return best
}

// Splits a chapter into pages that each fill the box without overflowing,
// measured with the firmware's glyph widths. Paragraphs split across pages
// at word boundaries (or mid-word if a single word cannot fit).
export function paginate(blocks: Block[], box: Box, measure: Measure = measureTextWrap): Page[] {
  const maxLines = Math.max(1, Math.floor(box.height / LINE_HEIGHT))
  const fits = (text: string) => text.length <= MAX_PAGE_CHARS && measure(text, box.width).lineCount <= maxLines

  const pages: Page[] = []
  let pos: ChapterPos = { block: 0, offset: 0 }
  while (pos.block < blocks.length) {
    const start = pos
    let text = ''
    while (pos.block < blocks.length) {
      const rest = blocks[pos.block].text.slice(pos.offset)
      const prefix = (text ? '\n' : '') + (pos.offset === 0 ? INDENT : '')
      if (fits(text + prefix + rest)) {
        text += prefix + rest
        pos = { block: pos.block + 1, offset: 0 }
        continue
      }
      const withCut = (n: number) => text + prefix + rest.slice(0, n).trimEnd()
      const points = breakPoints(rest)
      let cut = points[lastFitting(points, n => fits(withCut(n)))] ?? 0
      if (cut === 0 && !text) {
        // One word wider than the whole page: split it by characters.
        const chars = Array.from({ length: rest.length }, (_, i) => i + 1)
        cut = Math.max(1, chars[lastFitting(chars, n => fits(withCut(n)))] ?? 1)
      }
      if (cut > 0) {
        text = withCut(cut)
        const skipped = rest.slice(cut).length - rest.slice(cut).trimStart().length
        pos = { block: pos.block, offset: pos.offset + cut + skipped }
      }
      break
    }
    pages.push({ start, text })
  }
  return pages
}

// Index of the page containing `pos`: the last page starting at or before it.
export function pageAt(pages: Page[], pos: ChapterPos): number {
  let index = 0
  for (let i = 0; i < pages.length; i++) if (comparePos(pages[i].start, pos) <= 0) index = i
  return index
}
