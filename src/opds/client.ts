import { parseFeed, type BookEntry, type Feed } from './parse'

export type ServerConfig = {
  // Calibre-Web base URL, ending in '/'. May include a path prefix
  // (https://host/calibre/) when it is served under a sub-path.
  url: string
  // base64("user:password") for HTTP Basic auth.
  basic: string
}

export class OpdsError extends Error {
  constructor(
    message: string,
    readonly kind: 'auth' | 'network' | 'http' | 'format',
  ) {
    super(message)
  }
}

export class OpdsClient {
  constructor(private readonly server: ServerConfig) {}

  private async get(url: string): Promise<Response> {
    let res: Response
    try {
      res = await fetch(url, { headers: { Authorization: `Basic ${this.server.basic}` } })
    } catch {
      // fetch rejects without detail on DNS, TLS, VPN and CORS failures alike.
      throw new OpdsError(`Could not reach ${new URL(this.server.url).host} (network or CORS).`, 'network')
    }
    if (res.status === 401 || res.status === 403) throw new OpdsError('Username or password rejected.', 'auth')
    if (!res.ok) throw new OpdsError(`Server answered ${res.status} for ${new URL(url).pathname}.`, 'http')
    return res
  }

  // Relative paths resolve against the server URL; absolute ones (from feed
  // links) pass through.
  async feed(pathOrUrl: string): Promise<Feed> {
    const url = new URL(pathOrUrl, this.server.url).href
    const res = await this.get(url)
    try {
      return parseFeed(await res.text(), url)
    } catch {
      throw new OpdsError(`${new URL(url).pathname} is not an OPDS feed. Is this a Calibre-Web server?`, 'format')
    }
  }

  root(): Promise<Feed> {
    return this.feed('opds')
  }

  // Follows rel="next" until `limit` books are collected.
  async recentBooks(limit: number): Promise<BookEntry[]> {
    const books: BookEntry[] = []
    let feed: Feed | undefined = await this.feed('opds/new')
    while (feed) {
      books.push(...feed.entries.filter(e => e.kind === 'book'))
      if (books.length >= limit || !feed.next) break
      feed = await this.feed(feed.next)
    }
    return books.slice(0, limit)
  }

  async search(query: string): Promise<BookEntry[]> {
    const root = await this.root()
    const template = root.searchTemplate ?? 'opds/search/{searchTerms}'
    const feed = await this.feed(template.replace('{searchTerms}', encodeURIComponent(query)))
    return feed.entries.filter(e => e.kind === 'book')
  }

  async download(book: BookEntry): Promise<ArrayBuffer> {
    const res = await this.get(book.epubHref)
    return res.arrayBuffer()
  }
}
