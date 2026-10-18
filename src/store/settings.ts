import SparkMD5 from 'spark-md5'
import type { BookEntry } from '../opds/parse'

// Key-value storage. The app uses the Even bridge's storage, which persists
// per app on the phone; tests use a Map.
export type KeyValue = {
  get(key: string): Promise<string>
  set(key: string, value: string): Promise<unknown>
}

export type Settings = {
  url: string
  username: string
  // base64("user:password") for OPDS Basic auth.
  basic: string
  // md5(password) hex, the kosync x-auth-key. The password itself is not kept.
  koKey: string
}

const SETTINGS = 'settings'
const LAST_BOOK = 'lastBook'

export function normalizeServerUrl(raw: string): string {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    throw new Error('Enter a full URL, like https://books.example.com')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('The URL must start with https:// or http://')
  if (url.username || url.password) throw new Error('Put the username and password in their own fields, not the URL.')
  // Pasting the OPDS address is a likely mistake; trim it back to the base.
  const path = url.pathname.replace(/\/opds\/?$/, '/').replace(/\/?$/, '/')
  return url.origin + path
}

function base64Utf8(s: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(s)))
}

export function makeSettings(url: string, username: string, password: string): Settings {
  return {
    url: normalizeServerUrl(url),
    username: username.trim(),
    basic: base64Utf8(`${username.trim()}:${password}`),
    koKey: SparkMD5.hash(password),
  }
}

async function readJson<T>(kv: KeyValue, key: string): Promise<T | null> {
  const raw = await kv.get(key)
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export const loadSettings = (kv: KeyValue) => readJson<Settings>(kv, SETTINGS)
export const saveSettings = (kv: KeyValue, s: Settings) => kv.set(SETTINGS, JSON.stringify(s))
export const loadLastBook = (kv: KeyValue) => readJson<BookEntry>(kv, LAST_BOOK)
export const saveLastBook = (kv: KeyValue, b: BookEntry) => kv.set(LAST_BOOK, JSON.stringify(b))
