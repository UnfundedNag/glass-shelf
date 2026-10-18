import type { EvenAppBridge, EvenHubEvent } from '@evenrealities/even_hub_sdk'
import { OpdsClient, OpdsError } from '../opds/client'
import type { BookEntry } from '../opds/parse'
import type { BookCache } from '../store/books'
import { loadLastBook, loadSettings, saveLastBook, type KeyValue } from '../store/settings'
import { gestureOf, listIndexOf } from './input'
import { libraryItems, MAX_ITEMS, type LibraryItem } from './library'
import { Renderer, type Page } from './render'

type Screen =
  | { name: 'message'; page: Page; onTap?: () => void }
  | { name: 'library'; page: Page; items: LibraryItem[] }
  | { name: 'book'; page: Page }

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
    await this.show({ name: 'book', page: { kind: 'message', text: `${book.title}\n\nDownloading…` } })
    try {
      let bytes = await this.cache.get(book.id)
      const cached = bytes !== null
      if (!bytes) {
        bytes = await new OpdsClient(settings).download(book)
        await this.cache.put(book.id, bytes)
      }
      await saveLastBook(this.kv, book)
      const size = `${Math.round(bytes.byteLength / 1024)} KB${cached ? ', from cache' : ''}`
      const text = `${book.title}\n${book.author}\n\nEPUB ready (${size}).\nThe reader arrives in the next milestone.\n\nDouble-tap: back to library`
      await this.show({ name: 'book', page: { kind: 'message', text } })
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
        if (screen.name === 'book') await this.renderLibrary()
        // Root screens hand off to the host's exit dialogue (Even Hub review requirement).
        else await this.bridge.shutDownPageContainer(1)
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
  if (err instanceof OpdsError) return err.message
  return `Something went wrong: ${err instanceof Error ? err.message : String(err)}`
}
