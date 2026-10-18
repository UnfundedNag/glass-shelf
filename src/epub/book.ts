import JSZip from 'jszip'
import { blocksOf, type Block } from './blocks'

export type Chapter = {
  // 0-based spine index; KOReader's DocFragment[n] is this + 1.
  spineIndex: number
  href: string
  blocks: Block[]
  chars: number
  // The book's own table of contents: skipped when reading, since its
  // entries cannot be followed on the glasses.
  isToc: boolean
}

export type Book = {
  title: string
  // Every spine item, in order, including ones with no text (covers).
  chapters: Chapter[]
  totalChars: number
}

export class EpubError extends Error {}

const OPF_NS = 'http://www.idpf.org/2007/opf'
const DC_NS = 'http://purl.org/dc/elements/1.1/'
// Font obfuscation (IDPF and Adobe) is not DRM; the text is readable.
const FONT_OBFUSCATION = new Set(['http://www.idpf.org/2008/embedding', 'http://ns.adobe.com/pdf/enc#RC'])

function parseXml(text: string, what: string): Document {
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length) throw new EpubError(`Broken EPUB: unreadable ${what}.`)
  return doc
}

// Chapters are XHTML, but real-world files are often not well-formed; fall
// back to the forgiving HTML parser rather than dropping the chapter.
function parseChapter(text: string): Element | null {
  let doc = new DOMParser().parseFromString(text, 'application/xhtml+xml')
  if (doc.getElementsByTagName('parsererror').length) doc = new DOMParser().parseFromString(text, 'text/html')
  return doc.getElementsByTagNameNS('*', 'body')[0] ?? null
}

function resolvePath(base: string, href: string): string {
  const url = new URL(href, `epub:///${base}`)
  return decodeURIComponent(url.pathname.slice(1))
}

export async function loadEpub(bytes: ArrayBuffer): Promise<Book> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(bytes)
  } catch {
    throw new EpubError('This file is not a readable EPUB.')
  }
  const read = async (path: string, what: string) => {
    const file = zip.file(path)
    if (!file) throw new EpubError(`Broken EPUB: missing ${what}.`)
    return file.async('string')
  }

  if (zip.file('META-INF/encryption.xml')) {
    const enc = parseXml(await read('META-INF/encryption.xml', 'encryption info'), 'encryption info')
    const algorithms = Array.from(enc.getElementsByTagNameNS('*', 'EncryptionMethod')).map(m => m.getAttribute('Algorithm'))
    if (algorithms.some(a => !a || !FONT_OBFUSCATION.has(a))) throw new EpubError('This EPUB is DRM-protected.')
  }

  const container = parseXml(await read('META-INF/container.xml', 'container.xml'), 'container.xml')
  const opfPath = container.getElementsByTagNameNS('*', 'rootfile')[0]?.getAttribute('full-path')
  if (!opfPath) throw new EpubError('Broken EPUB: no package file.')
  const opf = parseXml(await read(opfPath, 'package file'), 'package file')

  const manifest = new Map<string, string>()
  const tocHrefs = new Set<string>()
  for (const item of Array.from(opf.getElementsByTagNameNS(OPF_NS, 'item'))) {
    const id = item.getAttribute('id')
    const href = item.getAttribute('href')
    if (id && href) manifest.set(id, resolvePath(opfPath, href))
    // EPUB 3 marks its navigation document with properties="nav".
    if (href && item.getAttribute('properties')?.split(/\s+/).includes('nav')) tocHrefs.add(resolvePath(opfPath, href))
  }
  // EPUB 2 points at it from the guide.
  for (const ref of Array.from(opf.getElementsByTagNameNS(OPF_NS, 'reference'))) {
    const href = ref.getAttribute('href')
    if (href && ref.getAttribute('type') === 'toc') tocHrefs.add(resolvePath(opfPath, href.split('#')[0]))
  }

  const chapters: Chapter[] = []
  let totalChars = 0
  const itemrefs = Array.from(opf.getElementsByTagNameNS(OPF_NS, 'itemref'))
  for (const [spineIndex, ref] of itemrefs.entries()) {
    const href = manifest.get(ref.getAttribute('idref') ?? '') ?? ''
    const file = href ? zip.file(href) : null
    const body = file ? parseChapter(await file.async('string')) : null
    const blocks = body ? blocksOf(body) : []
    const chars = blocks.reduce((n, b) => n + b.text.length, 0)
    chapters.push({ spineIndex, href, blocks, chars, isToc: tocHrefs.has(href) })
    totalChars += chars
  }
  if (totalChars === 0) throw new EpubError('This EPUB has no readable text.')

  const title = opf.getElementsByTagNameNS(DC_NS, 'title')[0]?.textContent?.trim() ?? ''
  return { title, chapters, totalChars }
}
