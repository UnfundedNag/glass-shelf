import type { Block } from '../epub/blocks'

// KOReader positions are CREngine XPointers:
//   /body/DocFragment[12]/body/div/p[3]/text().45
// DocFragment is the 1-based spine index; the rest is an element path inside
// that chapter, optionally ending in a text offset.

export type ParsedXPointer = {
  spineIndex: number
  // Element path inside the chapter, starting at /body (e.g. "/body/div/p[3]").
  elementPath: string
}

export function buildXPointer(spineIndex: number, blockPath: string): string {
  return `/body/DocFragment[${spineIndex + 1}]${blockPath}`
}

export function parseXPointer(xpointer: string): ParsedXPointer | null {
  // CREngine omits the index when a book has a single spine item.
  const m = xpointer.match(/^\/body\/DocFragment(?:\[(\d+)\])?(\/body(?:\/[^/]*)*)?$/)
  if (!m) return null
  const steps = (m[2] ?? '/body').split('/').filter(Boolean)
  // Drop a trailing text step ("text()", "text()[2].5", "text().45") or an
  // offset on the last element ("p[3].0"); element-level is enough to pick a block.
  const last = steps.at(-1) ?? ''
  if (/^text\(\)/.test(last)) steps.pop()
  else steps[steps.length - 1] = last.replace(/\.\d+$/, '')
  return { spineIndex: m[1] ? Number(m[1]) - 1 : 0, elementPath: '/' + steps.join('/') }
}

// Normalizes "p[1]" to "p" when comparing: CREngine writes the index only for
// repeated names, but other writers may always include it.
function steps(path: string): string[] {
  return path.split('/').filter(Boolean).map(s => s.replace(/\[1\]$/, ''))
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
