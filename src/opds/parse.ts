// Atom/OPDS feed parsing. Calibre-Web serves two feed shapes: navigation
// feeds (entries link to sub-feeds) and acquisition feeds (entries are books
// with download links). One parser handles both.

const ATOM = 'http://www.w3.org/2005/Atom'
const ACQUISITION = 'http://opds-spec.org/acquisition'
const EPUB_TYPE = 'application/epub+zip'

export type BookEntry = {
  kind: 'book'
  id: string
  title: string
  author: string
  epubHref: string
  updated: string
}

export type NavEntry = {
  kind: 'nav'
  id: string
  title: string
  href: string
}

export type Feed = {
  title: string
  entries: (BookEntry | NavEntry)[]
  next?: string
  // Atom search template with a {searchTerms} placeholder.
  searchTemplate?: string
}

function children(parent: Element, name: string): Element[] {
  return Array.from(parent.children).filter(el => el.namespaceURI === ATOM && el.localName === name)
}

function text(parent: Element, name: string): string {
  return children(parent, name)[0]?.textContent?.trim() ?? ''
}

function resolve(href: string, base: string): string {
  return new URL(href, base).href
}

// Calibre-Web labels kepub links application/epub+zip too, so a plain type
// match would pick the kepub. Kepub bytes differ from the EPUB that Readest
// downloads, and the kosync document hash would never match.
function isPlainEpub(link: Element): boolean {
  if (link.getAttribute('type') !== EPUB_TYPE) return false
  const title = link.getAttribute('title')?.toLowerCase()
  const href = link.getAttribute('href')?.toLowerCase() ?? ''
  return title !== 'kepub' && !/\/kepub\/?(\?|$)/.test(href)
}

function parseEntry(entry: Element, base: string): BookEntry | NavEntry | null {
  const id = text(entry, 'id')
  const title = text(entry, 'title')
  const links = children(entry, 'link')

  const acquisitions = links.filter(l => l.getAttribute('rel')?.startsWith(ACQUISITION))
  if (acquisitions.length > 0) {
    const epub = acquisitions.find(isPlainEpub)
    if (!epub) return null
    const authors = children(entry, 'author').map(a => text(a, 'name')).filter(Boolean)
    return {
      kind: 'book',
      id,
      title,
      author: authors.join(', '),
      epubHref: resolve(epub.getAttribute('href')!, base),
      updated: text(entry, 'updated'),
    }
  }

  const nav = links.find(l => l.getAttribute('type')?.startsWith('application/atom+xml'))
  if (nav) return { kind: 'nav', id, title, href: resolve(nav.getAttribute('href')!, base) }
  return null
}

export function parseFeed(xml: string, base: string): Feed {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const root = doc.documentElement
  if (root.localName !== 'feed' || root.namespaceURI !== ATOM) {
    throw new Error('Not an OPDS feed')
  }

  const links = children(root, 'link')
  const next = links.find(l => l.getAttribute('rel') === 'next')?.getAttribute('href')
  const search = links.find(
    l => l.getAttribute('rel') === 'search' && l.getAttribute('type')?.startsWith('application/atom+xml'),
  )?.getAttribute('href')

  return {
    title: text(root, 'title'),
    entries: children(root, 'entry')
      .map(e => parseEntry(e, base))
      .filter((e): e is BookEntry | NavEntry => e !== null),
    next: next ? resolve(next, base) : undefined,
    // Kept unresolved: resolving would percent-encode the braces.
    searchTemplate: search ?? undefined,
  }
}
