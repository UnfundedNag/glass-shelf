// EPUB bytes cache in IndexedDB. Keeps the most recently opened books; the
// kosync document hash must be computed on these exact bytes.

const DB = 'glass-shelf'
const STORE = 'epubs'

export type CachedBook = {
  id: string
  bytes: ArrayBuffer
  openedAt: number
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

let db: Promise<IDBDatabase> | undefined

function open(): Promise<IDBDatabase> {
  if (!db) {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' })
    db = request(req)
  }
  return db
}

export class BookCache {
  constructor(
    private readonly keep = 3,
    private readonly now: () => number = Date.now,
  ) {}

  private async store(mode: IDBTransactionMode): Promise<IDBObjectStore> {
    return (await open()).transaction(STORE, mode).objectStore(STORE)
  }

  // Returns the cached bytes and marks the book as most recently opened.
  async get(id: string): Promise<ArrayBuffer | null> {
    const book = await request<CachedBook | undefined>((await this.store('readonly')).get(id))
    if (!book) return null
    await request((await this.store('readwrite')).put({ ...book, openedAt: this.now() }))
    return book.bytes
  }

  async put(id: string, bytes: ArrayBuffer): Promise<void> {
    await request((await this.store('readwrite')).put({ id, bytes, openedAt: this.now() }))
    await this.prune()
  }

  async ids(): Promise<string[]> {
    return (await request((await this.store('readonly')).getAllKeys())).map(String)
  }

  private async prune(): Promise<void> {
    const books = await request<CachedBook[]>((await this.store('readonly')).getAll())
    const stale = books.sort((a, b) => b.openedAt - a.openedAt).slice(this.keep)
    const store = await this.store('readwrite')
    await Promise.all(stale.map(b => request(store.delete(b.id))))
  }
}
