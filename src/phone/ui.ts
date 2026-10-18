import { KosyncClient } from '../kosync/client'
import { OpdsClient } from '../opds/client'
import type { BookEntry } from '../opds/parse'
import { loadSettings, makeSettings, saveSettings, type KeyValue, type Settings } from '../store/settings'
import type { SyncEvent } from '../sync/session'

export type PhoneUiHooks = {
  onSettingsSaved(): void
  onSendToGlasses(book: BookEntry): void
}

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T
}

function setStatus(node: HTMLElement, text: string, error = false): void {
  node.textContent = text
  node.classList.toggle('error', error)
}

// Shows sync activity from the glasses ("Synced 47% · 12:41").
export function showSyncEvent(event: SyncEvent): void {
  const node = el('sync-status')
  const time = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  if (event.kind === 'pushed') setStatus(node, `Sync: sent ${Math.floor(event.percentage * 100)}% at ${time}.`)
  else if (event.kind === 'pulled') {
    const r = event.remote
    setStatus(
      node,
      r ? `Sync: server has ${Math.floor((r.percentage ?? 0) * 100)}% from ${r.device ?? 'another device'} (checked ${time}).` : `Sync: no saved position yet (checked ${time}).`,
    )
  } else setStatus(node, `Sync: ${event.message}`, true)
}

export async function startPhoneUi(kv: KeyValue, hooks: PhoneUiHooks): Promise<void> {
  const form = el<HTMLFormElement>('settings')
  const status = el('settings-status')
  const searchSection = el('search-section')
  const fields = form.elements as unknown as Record<'url' | 'username' | 'password', HTMLInputElement>

  // Shown so self-hosters can scope Access-Control-Allow-Origin (SPEC §11 Q2).
  el('app-origin').textContent = location.origin

  let settings = await loadSettings(kv)
  if (settings) {
    fields.url.value = settings.url
    fields.username.value = settings.username
    fields.password.placeholder = 'Saved. Leave blank to keep it.'
    searchSection.hidden = false
  }

  form.addEventListener('submit', async e => {
    e.preventDefault()
    const button = form.querySelector('button')!
    let next: Settings
    try {
      const sameUser = settings && fields.username.value.trim() === settings.username
      if (!fields.password.value && !sameUser) throw new Error('Enter the password.')
      next =
        fields.password.value || !settings
          ? makeSettings(fields.url.value, fields.username.value, fields.password.value)
          : { ...makeSettings(fields.url.value, settings.username, ''), basic: settings.basic, koKey: settings.koKey }
    } catch (err) {
      return setStatus(status, (err as Error).message, true)
    }

    button.disabled = true
    setStatus(status, 'Testing connection…')
    try {
      const root = await new OpdsClient(next).root()
      await saveSettings(kv, next)
      settings = next
      fields.password.value = ''
      fields.password.placeholder = 'Saved. Leave blank to keep it.'
      searchSection.hidden = false
      setStatus(status, `Connected to “${root.title || 'Calibre-Web'}”. Saved.`)
      // Reading still works without sync, so a sync failure only warns.
      const syncStatus = el('sync-status')
      try {
        await new KosyncClient(next).authorize()
        setStatus(syncStatus, 'Sync: KOReader sync login works.')
      } catch (err) {
        setStatus(syncStatus, `Sync: ${(err as Error).message} Reading works; progress will not sync.`, true)
      }
      hooks.onSettingsSaved()
    } catch (err) {
      setStatus(status, `${(err as Error).message} Not saved.`, true)
    } finally {
      button.disabled = false
    }
  })

  const search = el<HTMLFormElement>('search')
  const searchStatus = el('search-status')
  const results = el<HTMLUListElement>('results')

  search.addEventListener('submit', async e => {
    e.preventDefault()
    if (!settings) return
    const q = (search.elements.namedItem('q') as HTMLInputElement).value.trim()
    results.replaceChildren()
    setStatus(searchStatus, 'Searching…')
    try {
      const books = await new OpdsClient(settings).search(q)
      setStatus(searchStatus, books.length ? '' : 'No EPUB books found.')
      results.replaceChildren(...books.map(book => resultRow(book, hooks)))
    } catch (err) {
      setStatus(searchStatus, (err as Error).message, true)
    }
  })
}

function resultRow(book: BookEntry, hooks: PhoneUiHooks): HTMLLIElement {
  const li = document.createElement('li')
  const meta = document.createElement('div')
  meta.className = 'meta'
  const title = document.createElement('div')
  title.textContent = book.title
  const author = document.createElement('div')
  author.className = 'author'
  author.textContent = book.author
  meta.append(title, author)

  const send = document.createElement('button')
  send.type = 'button'
  send.textContent = 'Send to glasses'
  send.addEventListener('click', () => {
    hooks.onSendToGlasses(book)
    send.textContent = 'Sent'
  })

  li.append(meta, send)
  return li
}
