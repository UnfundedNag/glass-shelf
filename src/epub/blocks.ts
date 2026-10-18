import { normalizeChar } from './text'

// One text node, described the way CREngine (KOReader's engine) addresses it.
export type TextRun = {
  // Path of the text node's parent element, e.g. "/body/div/p[3]/em".
  path: string
  // 1-based index among the parent's text children that CREngine keeps, and
  // how many it keeps. 0 when CREngine drops this node.
  index: number
  count: number
  // Inside <pre> and friends offsets count raw characters; elsewhere each
  // whitespace run counts as one.
  pre: boolean
  data: string
}

export type Source = TextRun | 'br'

// A run of readable text and the element it came from. `path` is the
// CREngine-style element path inside the chapter (e.g. "/body/div/p[3]"),
// which KOReader xpointers build on (SPEC §5). `sources` keeps the raw text
// nodes so a text offset can be mapped back to a node offset on demand.
export type Block = { path: string; text: string; sources: Source[] }

// Where a character of block text came from: run index into `sources` and
// the CREngine offset inside that run.
export type TextPoint = { run: number; offset: number }

const BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'blockquote', 'body', 'caption', 'dd', 'details', 'div', 'dl', 'dt',
  'figcaption', 'figure', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'li', 'main',
  'nav', 'ol', 'p', 'pre', 'section', 'summary', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul',
])
// Containers where CREngine drops a whitespace-only text node that opens them.
const DROPS_LEADING_BLANK = new Set([...BLOCK_TAGS, 'center', 'fieldset', 'form'])
const PRE_TAGS = new Set(['pre', 'code', 'listing', 'plaintext', 'xmp', 'textarea'])
const SKIP_TAGS = new Set(['head', 'script', 'style', 'svg', 'math', 'img', 'image', 'audio', 'video', 'object', 'rt', 'rp'])
const HTML_SPACE = /[ \t\n\r\f]/

const isBlock = (el: Element) => BLOCK_TAGS.has(el.localName)
const hasBlockChild = (el: Element): boolean => Array.from(el.children).some(c => isBlock(c) || hasBlockChild(c))
const isText = (n: Node) => n.nodeType === Node.TEXT_NODE || n.nodeType === Node.CDATA_SECTION_NODE

// CREngine names a step "name[index]" with a 1-based index among same-name
// element siblings, and drops the index when the name is unique.
function step(el: Element): string {
  const same = Array.from(el.parentElement?.children ?? []).filter(s => s.localName === el.localName)
  return same.length > 1 ? `${el.localName}[${same.indexOf(el) + 1}]` : el.localName
}

function pathOf(el: Element, body: Element): string {
  const steps: string[] = []
  for (let n: Element | null = el; n && n !== body; n = n.parentElement) steps.unshift(step(n))
  return '/' + ['body', ...steps].join('/')
}

function preservesWhitespace(node: Node): boolean {
  for (let el = node.parentElement; el; el = el.parentElement) if (PRE_TAGS.has(el.localName)) return true
  return false
}

// The parent's text children as CREngine keeps them: empty nodes go, and so
// does a whitespace-only node that opens a block.
function keptTextChildren(parent: Element): Node[] {
  const dropsBlank = DROPS_LEADING_BLANK.has(parent.localName) && !preservesWhitespace(parent.firstChild ?? parent)
  return Array.from(parent.childNodes).filter(
    (n, i) => isText(n) && (n.textContent ?? '') !== '' && !(dropsBlank && i === 0 && !(n.textContent ?? '').trim()),
  )
}

function textRun(node: Node, body: Element): TextRun {
  const parent = node.parentElement ?? body
  const kept = keptTextChildren(parent)
  return {
    path: pathOf(parent, body),
    index: kept.indexOf(node) + 1,
    count: kept.length,
    pre: preservesWhitespace(node),
    data: node.textContent ?? '',
  }
}

// Builds a block's display text from its sources: G2 font cleanup, HTML
// whitespace collapsing, <br> as line breaks. With `map`, also records where
// each output character came from (null for inserted line breaks).
export function blockText(sources: Source[], map?: (TextPoint | null)[]): string {
  type Unit = { ch: string; at: TextPoint | null }
  const lines: Unit[][] = [[]]
  sources.forEach((source, run) => {
    if (source === 'br') return void lines.push([])
    let collapsed = 0
    for (let i = 0; i < source.data.length; i++) {
      const raw = source.data[i]
      const continuation = i > 0 && HTML_SPACE.test(raw) && HTML_SPACE.test(source.data[i - 1])
      const at = { run, offset: source.pre ? i : collapsed }
      if (!continuation) collapsed++
      for (const ch of normalizeChar(raw)) lines[lines.length - 1].push({ ch, at })
    }
  })

  // Collapse whitespace runs and trim each line, then allow at most one
  // blank line in a row and trim the whole block.
  const collapsedLines = lines.map(line => {
    const out: Unit[] = []
    for (const u of line) {
      const space = /[ \t\f]/.test(u.ch)
      if (space && (out.length === 0 || out[out.length - 1].ch === ' ')) continue
      out.push(space ? { ch: ' ', at: u.at } : u)
    }
    while (out.length && out[out.length - 1].ch === ' ') out.pop()
    return out
  })
  const units: Unit[] = []
  let blankRun = 0
  for (const line of collapsedLines) {
    if (line.length === 0) {
      if (++blankRun > 1) continue
    } else {
      blankRun = 0
    }
    if (units.length || line.length) {
      if (units.length) units.push({ ch: '\n', at: null })
      units.push(...line)
    }
  }
  while (units.length && units[units.length - 1].ch === '\n') units.pop()

  if (map) map.push(...units.map(u => u.at))
  return units.map(u => u.ch).join('')
}

function collect(node: Node, body: Element, sources: Source[]): void {
  if (isText(node)) return void sources.push(textRun(node, body))
  if (node.nodeType !== Node.ELEMENT_NODE) return
  const el = node as Element
  if (SKIP_TAGS.has(el.localName)) return
  if (el.localName === 'br') return void sources.push('br')
  for (const child of Array.from(el.childNodes)) collect(child, body, sources)
}

export function blocksOf(body: Element): Block[] {
  const blocks: Block[] = []
  const emit = (el: Element, sources: Source[]) => {
    const text = blockText(sources)
    if (text) blocks.push({ path: pathOf(el, body), text, sources })
  }

  const walk = (el: Element) => {
    if (SKIP_TAGS.has(el.localName)) return
    if (!hasBlockChild(el)) {
      const sources: Source[] = []
      for (const child of Array.from(el.childNodes)) collect(child, body, sources)
      return emit(el, sources)
    }
    // Mixed content: text between block children becomes its own block,
    // addressed by the parent element.
    let run: Source[] = []
    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType === Node.ELEMENT_NODE && (isBlock(child as Element) || hasBlockChild(child as Element))) {
        emit(el, run)
        run = []
        walk(child as Element)
      } else {
        collect(child, body, run)
      }
    }
    emit(el, run)
  }

  walk(body)
  return blocks
}
