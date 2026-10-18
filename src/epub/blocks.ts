import { collapseWhitespace, normalizeText } from './text'

// A run of readable text and the element it came from. `path` is the
// CREngine-style element path inside the chapter (e.g. "/body/div/p[3]"),
// which KOReader xpointers build on (SPEC §5).
export type Block = { path: string; text: string }

const BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'blockquote', 'body', 'caption', 'dd', 'details', 'div', 'dl', 'dt',
  'figcaption', 'figure', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'li', 'main',
  'nav', 'ol', 'p', 'pre', 'section', 'summary', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul',
])
const SKIP_TAGS = new Set(['head', 'script', 'style', 'svg', 'math', 'img', 'image', 'audio', 'video', 'object', 'rt', 'rp'])

const isBlock = (el: Element) => BLOCK_TAGS.has(el.localName)
const hasBlockChild = (el: Element): boolean => Array.from(el.children).some(c => isBlock(c) || hasBlockChild(c))

// CREngine names a step "name[index]" with a 1-based index among
// same-name element siblings, and drops the index when the name is unique.
// To verify against KOReader in M4.
function step(el: Element): string {
  const same = Array.from(el.parentElement?.children ?? []).filter(s => s.localName === el.localName)
  return same.length > 1 ? `${el.localName}[${same.indexOf(el) + 1}]` : el.localName
}

function pathOf(el: Element, body: Element): string {
  const steps: string[] = []
  for (let n: Element | null = el; n && n !== body; n = n.parentElement) steps.unshift(step(n))
  return '/' + ['body', ...steps].join('/')
}

function inlineText(node: Node): string {
  // Newlines in markup are plain whitespace; only <br> breaks a line.
  if (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.CDATA_SECTION_NODE) {
    return (node.textContent ?? '').replace(/[\n\r]+/g, ' ')
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return ''
  const el = node as Element
  if (SKIP_TAGS.has(el.localName)) return ''
  if (el.localName === 'br') return '\n'
  return Array.from(el.childNodes).map(inlineText).join('')
}

export function blocksOf(body: Element): Block[] {
  const blocks: Block[] = []
  const emit = (el: Element, raw: string) => {
    const text = collapseWhitespace(normalizeText(raw))
    if (text) blocks.push({ path: pathOf(el, body), text })
  }

  const walk = (el: Element) => {
    if (SKIP_TAGS.has(el.localName)) return
    if (!hasBlockChild(el)) return emit(el, inlineText(el))
    // Mixed content: text between block children becomes its own block,
    // addressed by the parent element.
    let run = ''
    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType === Node.ELEMENT_NODE && (isBlock(child as Element) || hasBlockChild(child as Element))) {
        emit(el, run)
        run = ''
        walk(child as Element)
      } else {
        run += inlineText(child)
      }
    }
    emit(el, run)
  }

  walk(body)
  return blocks
}
