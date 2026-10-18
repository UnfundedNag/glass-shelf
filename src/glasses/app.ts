import type { EvenAppBridge, EvenHubEvent } from '@evenrealities/even_hub_sdk'
import { EpubError, loadEpub } from '../epub/book'
import { OpdsClient, OpdsError } from '../opds/client'
import type { BookEntry } from '../opds/parse'
import { Reader } from '../reader/reader'
import type { BookCache } from '../store/books'
import { loadPosition, savePosition } from '../store/positions'
import { loadLastBook, loadSettings, saveLastBook, type KeyValue } from '../store/settings'
import { footerText } from './footer'
import { gestureOf, listIndexOf } from './input'
import { libraryItems, MAX_ITEMS, type LibraryItem } from './library'
import { FOOTER_WIDTH, READER_BOX, Renderer, type Page } from './render'

type Screen =
  | { name: 'message'; page: Page; onTap?: () => void }
  | { name: 'library'; page: Page; items: LibraryItem[] }
  // Opening a book, or a book that failed to open: double-tap goes back.
  | { name: 'book'; page: Page }
  | { name: 'reader'; page: Page & { kind: 'reader' }; book: BookEntry; reader: Reader; footer: boolean }

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
    } catch (err) {
      await this.message(`${describe(err)}\n\nTap to retry · double-tap to exit.`, () => void this.showLibrary())
    }
  }

  async openBook(book: BookEntry): Promise<void> {
    const settings = await loadSettings(this.kv)
    if (!settings) return
    await this.show({ name: 'book', page: { kind: 'message', text: `${book.title}\n\nOpening…` } })
    try {
      let bytes = await this.cache.get(book.id)
      if (!bytes) {
        await this.renderer.show({ kind: 'message', text: `${book.title}\n\nDownloading…` })
        bytes = await new OpdsClient(settings).download(book)
        await this.cache.put(book.id, bytes)
      }
      const reader = new Reader(await loadEpub(bytes), READER_BOX)
      const saved = await loadPosition(this.kv, book.id)
      if (saved) reader.seek(saved)
      await saveLastBook(this.kv, book)
      await this.show({ name: 'reader', page: this.readerPage(reader, true), book, reader, footer: true })
    } catch (err) {
      await this.show({
        name: 'book',
        page: { kind: 'message', text: `${book.title}\n\n${describe(err)}\n\nDouble-tap: back to library` },
      })
    }
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

  // Page turns update the containers in place rather than rebuilding.
  private async turn(screen: Screen & { name: 'reader' }, forward: boolean): Promise<void> {
    const moved = forward ? screen.reader.next() : screen.reader.prev()
    const page = this.readerPage(screen.reader, screen.footer)
    // At either end nothing moves; still refresh the footer (clock, "End of book").
    await this.renderer.updateReader(moved ? page.body : null, page.footer)
    screen.page = page
    if (moved) void savePosition(this.kv, screen.book.id, screen.reader.position())
  }

  private async toggleFooter(screen: Screen & { name: 'reader' }): Promise<void> {
    screen.footer = !screen.footer
    screen.page = this.readerPage(screen.reader, screen.footer)
    await this.renderer.updateReader(null, screen.page.footer)
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
    if (this.busy) return

    this.busy = true
    try {
      if (gesture === 'double-tap') {
        if (screen.name === 'reader') {
          await savePosition(this.kv, screen.book.id, screen.reader.position())
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

function describe(err: unknown): string {
  if (err instanceof OpdsError || err instanceof EpubError) return err.message
  return `Something went wrong: ${err instanceof Error ? err.message : String(err)}`
}
