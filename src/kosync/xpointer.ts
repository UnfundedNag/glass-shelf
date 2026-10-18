import { blockText, type Block, type TextPoint, type TextRun } from '../epub/blocks'
import type { ChapterPos } from '../paginate/paginate'

// KOReader positions are CREngine XPointers:
//   /body/DocFragment[12]/body/div/p[3]/text().45
//   /body/DocFragment[12]/body/div/p[3]/text()[2].5
// DocFragment is the 1-based spine index; then the path of the element that
// directly holds the text, which of its text nodes (when it has several), and
// the offset inside that node with each whitespace run counted once.

export type ParsedXPointer = {
  spineIndex: number
  // Element path inside the chapter, starting at /body (e.g. "/body/div/p[3]").
  elementPath: string
  // Present for text positions: 1-based text node index and offset.
  text?: { index: number; offset: number }
}

export function parseXPointer(xpointer: string): ParsedXPointer | null {
  // CREngine omits the index when a book has a single spine item.
  const m = xpointer.match(/^\/body\/DocFragment(?:\[(\d+)\])?(\/body(?:\/[^/]*)*)?$/)
  if (!m) return null
  const steps = (m[2] ?? '/body').split('/').filter(Boolean)
  const spineIndex = m[1] ? Number(m[1]) - 1 : 0
  const last = steps.at(-1) ?? ''
  const text = last.match(/^text\(\)(?:\[(\d+)\])?(?:\.(\d+))?$/)
  if (text) {
    steps.pop()
    const offset = text[2] === undefined ? 0 : Number(text[2])
    return { spineIndex, elementPath: '/' + steps.join('/'), text: { index: Number(text[1] ?? 1), offset } }
  }
  // "p[3].0": an offset on the element itself, i.e. its start for our purposes.
  steps[steps.length - 1] = last.replace(/\.\d+$/, '')
  return { spineIndex, elementPath: '/' + steps.join('/') }
}

// Normalizes "p[1]" to "p" when comparing: CREngine writes the index only for
// repeated names, but other writers may always include it.
function steps(path: string): string[] {
  return path.split('/').filter(Boolean).map(s => s.replace(/\[1\]$/, ''))
}

function samePath(a: string, b: string): boolean {
  const x = steps(a)
  const y = steps(b)
  return x.length === y.length && x.every((s, i) => s === y[i])
}

function isPrefix(prefix: string[], of: string[]): boolean {
  return prefix.length <= of.length && prefix.every((s, i) => s === of[i])
}

// Index of the block an element path points into: the block itself, the block
// containing it (an inline <span> inside a <p>), or the first block inside it
// (a wrapper <div>). Null if the path is not in this chapter.
export function blockForPath(blocks: Block[], elementPath: string): number | null {
  const target = steps(elementPath)
  const paths = blocks.map(b => steps(b.path))
  const exact = paths.findIndex(p => p.length === target.length && isPrefix(p, target))
  if (exact >= 0) return exact
  let containing = -1
  paths.forEach((p, i) => {
    if (isPrefix(p, target) && (containing < 0 || p.length > paths[containing].length)) containing = i
  })
  if (containing >= 0) return containing
  const inside = paths.findIndex(p => isPrefix(target, p))
  return inside >= 0 ? inside : null
}

function textMap(block: Block): (TextPoint | null)[] {
  const map: (TextPoint | null)[] = []
  blockText(block.sources, map)
  return map
}

// The XPointer of a character in a chapter, as KOReader would write it.
export function xpointerAt(spineIndex: number, blocks: Block[], pos: ChapterPos): string {
  const fragment = `/body/DocFragment[${spineIndex + 1}]`
  const block = blocks[pos.block]
  if (!block) return `${fragment}/body`
  const map = textMap(block)
  // The character at the offset, or the nearest one that came from the text
  // (line breaks from <br> have no source).
  let at: TextPoint | null = null
  for (let i = pos.offset; i < map.length && !at; i++) at = map[i]
  for (let i = Math.min(pos.offset, map.length) - 1; i >= 0 && !at; i--) at = map[i]
  const run = at ? (block.sources[at.run] as TextRun) : null
  if (!at || !run || run.index === 0) return fragment + block.path
  const node = run.count > 1 ? `text()[${run.index}]` : 'text()'
  return `${fragment}${run.path}/${node}.${at.offset}`
}

// Where in a chapter an XPointer points, down to the character when it names
// a text node. Null if it is not in this chapter's blocks.
export function locate(blocks: Block[], parsed: ParsedXPointer): (ChapterPos & { exact: boolean }) | null {
  if (parsed.text) {
    const { index, offset } = parsed.text
    for (const [b, block] of blocks.entries()) {
      const runs = block.sources.flatMap((s, i) => (s !== 'br' && s.index === index && samePath(s.path, parsed.elementPath) ? [i] : []))
      if (runs.length === 0) continue
      const map = textMap(block)
      // First character at or after the offset in that node; if the offset
      // fell in collapsed whitespace or past the end, the last one before it.
      let best = -1
      for (let i = 0; i < map.length; i++) {
        const at = map[i]
        if (!at || !runs.includes(at.run)) continue
        if (at.offset >= offset) return { block: b, offset: i, exact: true }
        best = i
      }
      if (best >= 0) return { block: b, offset: best, exact: true }
    }
  }
  const block = blockForPath(blocks, parsed.elementPath)
  return block === null ? null : { block, offset: 0, exact: false }
}
