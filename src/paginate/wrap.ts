import { measureTextWrap } from '@evenrealities/pretext'

// Line count as the G2 firmware wraps text. Glyph widths come from pretext,
// which matched the simulator to the pixel. The wrap rule differs from
// pretext's: a word stays on a line only if the line *plus the space after
// it* fits, so a 566 px line followed by more words wraps in a 568 px box,
// while a 567 px line that ends a paragraph does not.

// pretext rounds each glyph (with kerning) before adding up, so a line's width
// is its words' widths plus the gaps between them. A gap is the space's
// advance plus kerning against its neighbours: 3-6 px, depending only on the
// last letter before it and the first letter after it. (pretext reports a
// lone space as 0 px, so gaps are measured between letters.)
const measure = (s: string) => measureTextWrap(s, 1e6).lineWidths[0] ?? 0

const words = new Map<string, number>()
const gaps = new Map<string, number>()

function cached(map: Map<string, number>, key: string, compute: () => number): number {
  let w = map.get(key)
  if (w === undefined) {
    w = compute()
    if (map.size > 50_000) map.clear()
    map.set(key, w)
  }
  return w
}

const wordWidth = (word: string) => cached(words, word, () => measure(word))
const last = (word: string) => word.slice(-1)
const first = (word: string) => Array.from(word)[0] ?? ''
function gap(before: string, after: string): number {
  const a = last(before)
  const b = first(after)
  return cached(gaps, a + b, () => measure(`${a} ${b}`) - measure(a) - measure(b))
}

export function g2LineCount(text: string, maxWidth: number): number {
  let lines = 0
  for (const paragraph of text.split('\n')) {
    const ws = paragraph.split(' ')
    // A word wider than the whole line is broken by characters; leave that
    // rare case to pretext, with room for a space.
    if (ws.some(w => wordWidth(w) > maxWidth)) {
      lines += measureTextWrap(paragraph, maxWidth - 6).lineCount
      continue
    }
    lines++
    let lineWidth = -1
    ws.forEach((word, i) => {
      const next = lineWidth < 0 ? wordWidth(word) : lineWidth + gap(ws[i - 1], word) + wordWidth(word)
      const trailing = i < ws.length - 1 ? gap(word, ws[i + 1]) : 0
      if (lineWidth < 0 || next + trailing <= maxWidth) {
        lineWidth = next
      } else {
        lines++
        lineWidth = wordWidth(word)
      }
    })
  }
  return lines
}

export function g2Measure(text: string, maxWidth: number): { lineCount: number } {
  return { lineCount: g2LineCount(text, maxWidth) }
}

// The same rule measuring whole lines, without caching or summing. Slow; for
// tests that check the fast version.
export function g2LineCountExact(text: string, maxWidth: number): number {
  let lines = 0
  for (const paragraph of text.split('\n')) {
    const ws = paragraph.split(' ')
    if (ws.some(w => measure(w) > maxWidth)) {
      lines += measureTextWrap(paragraph, maxWidth - 6).lineCount
      continue
    }
    lines++
    let line = ''
    ws.forEach((word, i) => {
      const candidate = line ? `${line} ${word}` : word
      const next = ws[i + 1]
      const trailing = next === undefined ? 0 : measure(`${word} ${next}`) - measure(word) - measure(next)
      if (!line || measure(candidate) + trailing <= maxWidth) {
        line = candidate
      } else {
        lines++
        line = word
      }
    })
  }
  return lines
}
