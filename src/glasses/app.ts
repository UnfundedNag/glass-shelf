import type { EvenAppBridge, EvenHubEvent } from '@evenrealities/even_hub_sdk'
import { EpubError, loadEpub } from '../epub/book'
import { KosyncClient, type AuthMode } from '../kosync/client'
import { koPartialMd5 } from '../kosync/hash'
import { OpdsClient, OpdsError } from '../opds/client'
import type { BookEntry } from '../opds/parse'
import { Reader } from '../reader/reader'
import type { BookCache } from '../store/books'
import { loadPosition, savePosition } from '../store/positions'
import { loadLastBook, loadSettings, saveLastBook, type KeyValue, type Settings } from '../store/settings'
import { deviceId, retryPending, SyncSession, type Jump, type SyncEvent } from '../sync/session'
import { footerText } from './footer'
import { gestureOf, listIndexOf } from './input'
import { libraryItems, MAX_ITEMS, type LibraryItem } from './library'
import { FOOTER_WIDTH, READER_BOX, Renderer, type Page } from './render'

// How long opening a book waits for the sync server before reading locally.
const PULL_TIMEOUT_MS = 4000
const AUTH_MODE = 'kosync:auth'

type ReaderScreen = {
  name: 'reader'
  page: Page & { kind: 'reader' }
  book: BookEntry
  // KOReader document hash: the sync key and the local position key.
  document: string
  reader: Reader
  sync: SyncSession
  footer: boolean
}

type Screen =
  | { name: 'message'; page: Page; onTap?: () => void }
  | { name: 'library'; page: Page; items: LibraryItem[] }
  // Opening a book, or a book that failed to open: double-tap goes back.
  | { name: 'book'; page: Page }
  // "Jump to 47%?" after opening: tap jumps, double-tap stays.
  | { name: 'prompt'; page: Page; jump: Jump; reading: ReaderScreen }
  | ReaderScreen

export type GlassesHooks = {
  onSync?(event: SyncEvent): void
}

export class GlassesApp {
  private readonly renderer: Renderer
  private screen: Screen | null = null
  private recent: BookEntry[] = []
  // Drops input while a screen change is in flight, which also absorbs the
  // duplicate events the firmware can send for one gesture.
  private busy = false

  constructor(
    private readonly bridge: EvenAppBridge,
    private readonly kv: KeyValue,
    private readonly cache: BookCache,
    private readonly hooks: GlassesHooks = {},
  ) {
    this.renderer = new Renderer(bridge)
  }

  start(): void {
    this.bridge.onEvenHubEvent(event => void this.onEvent(event))
    void this.showLibrary()
  }

  // Reloads the library from the server, e.g. after settings change.
  async showLibrary(): Promise<void> {
    const settings = await loadSettings(this.kv)
    if (!settings) {
      return this.message('Glass Shelf\n\nSet up your Calibre-Web server in the Glass Shelf page on your phone.')
    }
    await this.message('Loading library…')
    try {
      const client = new OpdsClient(settings)
      this.recent = await client.recentBooks(MAX_ITEMS)
      if (this.recent.length === 0) {
        return this.message('No EPUB books found in your library.\n\nTap to retry · double-tap to exit.', () =>
          void this.showLibrary(),
        )
      }
      await this.renderLibrary()
      // The server is reachable: send any progress saved while offline.
      void retryPending(await this.syncClient(settings), this.kv)
    } catch (err) {
      await this.message(`${describe(err)}\n\nTap to retry · double-tap to exit.`, () => void this.showLibrary())
    }
  }

  async openBook(book: BookEntry): Promise<void> {
    const settings = await loadSettings(this.kv)
    if (!settings) return
    await this.leaveReader()
    await this.show({ name: 'book', page: { kind: 'message', text: `${book.title}\n\nOpening…` } })
    try {
      let bytes = await this.cache.get(book.id)
      if (!bytes) {
        await this.renderer.show({ kind: 'message', text: `${book.title}\n\nDownloading…` })
        bytes = await new OpdsClient(settings).download(book)
        await this.cache.put(book.id, bytes)
      }
      const document = koPartialMd5(bytes)
      const reader = new Reader(await loadEpub(bytes), READER_BOX)
      const saved = await loadPosition(this.kv, document)
      if (saved) reader.seek(saved)
      await saveLastBook(this.kv, book)

      const client = await this.syncClient(settings)
      const sync = new SyncSession(client, this.kv, document, reader, await deviceId(this.kv), e => this.onSync(e, client))
      const reading: ReaderScreen = {
        name: 'reader',
        page: this.readerPage(reader, true),
        book,
        document,
        reader,
        sync,
        footer: true,
      }
      const jump = await withTimeout(sync.pull(), PULL_TIMEOUT_MS)
      if (jump) await this.show({ name: 'prompt', page: { kind: 'message', text: promptText(jump) }, jump, reading })
      else await this.show(reading)
    } catch (err) {
      await this.show({
        name: 'book',
        page: { kind: 'message', text: `${book.title}\n\n${describe(err)}\n\nDouble-tap: back to library` },
      })
    }
  }

  private async syncClient(settings: Settings): Promise<KosyncClient> {
    const mode = (await this.kv.get(AUTH_MODE)) as AuthMode | ''
    return new KosyncClient(settings, mode || 'basic')
  }

  private onSync(event: SyncEvent, client: KosyncClient): void {
    // Remember which login the server accepted, to skip a failed attempt next time.
    if (event.kind !== 'error') void this.kv.set(AUTH_MODE, client.authMode)
    this.hooks.onSync?.(event)
  }

  private async renderLibrary(): Promise<void> {
    const items = libraryItems(this.recent, await loadLastBook(this.kv))
    return this.show({
      name: 'library',
      page: { kind: 'list', title: 'Glass Shelf', items: items.map(i => i.label) },
      items,
    })
  }

  private readerPage(reader: Reader, footer: boolean): Page & { kind: 'reader' } {
    const view = reader.view()
    return { kind: 'reader', body: view.text, footer: footer ? footerText(view, new Date(), FOOTER_WIDTH) : ' ' }
  }

  private async enterReader(reading: ReaderScreen): Promise<void> {
    reading.page = this.readerPage(reading.reader, reading.footer)
    await this.show(reading)
  }

  // Page turns update the containers in place rather than rebuilding.
  private async turn(screen: ReaderScreen, forward: boolean): Promise<void> {
    const moved = forward ? screen.reader.next() : screen.reader.prev()
    const page = this.readerPage(screen.reader, screen.footer)
    // At either end nothing moves; still refresh the footer (clock, "End of book").
    await this.renderer.updateReader(moved ? page.body : null, page.footer)
    screen.page = page
    if (moved) {
      void savePosition(this.kv, screen.document, screen.reader.position())
      screen.sync.schedulePush()
    }
  }

  private async toggleFooter(screen: ReaderScreen): Promise<void> {
    screen.footer = !screen.footer
    screen.page = this.readerPage(screen.reader, screen.footer)
    await this.renderer.updateReader(null, screen.page.footer)
  }

  // Saves the position and pushes any waiting progress. Safe to call anywhere.
  private async leaveReader(): Promise<void> {
    const screen = this.screen
    if (screen?.name !== 'reader') return
    await savePosition(this.kv, screen.document, screen.reader.position())
    void screen.sync.flush()
  }

  private message(text: string, onTap?: () => void): Promise<void> {
    return this.show({ name: 'message', page: { kind: 'message', text }, onTap })
  }

  private async show(screen: Screen): Promise<void> {
    this.screen = screen
    await this.renderer.show(screen.page)
  }

  private async onEvent(event: EvenHubEvent): Promise<void> {
    const gesture = gestureOf(event)
    const screen = this.screen
    if (!gesture || !screen) return

    // The host clears the page when it shows the exit dialogue and when the
    // app returns from the background; redraw what we had.
    if (gesture === 'foreground') return void this.renderer.show(screen.page)
    // Backgrounded or closing: this may be the last chance to sync (SPEC §5).
    if (gesture === 'background' || gesture === 'exit') return void this.leaveReader()
    if (this.busy) return

    this.busy = true
    try {
      if (screen.name === 'prompt') {
        if (gesture === 'tap') {
          screen.reading.reader.seek(screen.jump.target)
          screen.reading.sync.markSynced()
          void savePosition(this.kv, screen.reading.document, screen.reading.reader.position())
          await this.enterReader(screen.reading)
        } else if (gesture === 'double-tap') {
          await this.enterReader(screen.reading)
        }
      } else if (gesture === 'double-tap') {
        if (screen.name === 'reader') {
          await this.leaveReader()
          await this.renderLibrary()
        } else if (screen.name === 'book') {
          await this.renderLibrary()
        } else {
          // Root screens hand off to the host's exit dialogue (Even Hub review requirement).
          await this.bridge.shutDownPageContainer(1)
        }
      } else if (screen.name === 'reader') {
        if (gesture === 'swipe-down') await this.turn(screen, true)
        else if (gesture === 'swipe-up') await this.turn(screen, false)
        else if (gesture === 'tap') await this.toggleFooter(screen)
      } else if (gesture === 'tap') {
        if (screen.name === 'library') {
          const index = listIndexOf(event)
          const item = index === null ? undefined : screen.items[index]
          if (item) await this.openBook(item.book)
        } else if (screen.name === 'message') {
          screen.onTap?.()
        }
      }
    } finally {
      this.busy = false
    }
  }
}

function promptText(jump: Jump): string {
  const percent = Math.floor((jump.remote.percentage ?? jump.target.percentage) * 100)
  // Some servers report future times (CWA returned GET timestamps 4 h ahead
  // when its clock zone was UTC-4); a wrong age is worse than none.
  const at = jump.remote.timestamp ? jump.remote.timestamp * 1000 : null
  const from = [jump.remote.device, at && at <= Date.now() + 60_000 ? ago(at) : null]
    .filter(Boolean)
    .join(' · ')
  return `Jump to ${percent}%${from ? ` (${from})` : ''}?\n\nTap = yes · double-tap = no`
}

export function ago(then: number, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - then) / 60_000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([promise, new Promise<null>(resolve => setTimeout(() => resolve(null), ms))])
}

function describe(err: unknown): string {
  if (err instanceof OpdsError || err instanceof EpubError) return err.message
  return `Something went wrong: ${err instanceof Error ? err.message : String(err)}`
}
