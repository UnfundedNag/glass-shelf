import type { Position } from '../reader/reader'
import type { KeyValue } from './settings'

// Local reading positions, one per book. Keyed by the OPDS book id for now;
// M3 moves to the KOReader document hash so positions match kosync.
export type SavedPosition = Position & { savedAt: number }

const key = (bookId: string) => `pos:${bookId}`

export async function loadPosition(kv: KeyValue, bookId: string): Promise<SavedPosition | null> {
  const raw = await kv.get(key(bookId))
  if (!raw) return null
  try {
    return JSON.parse(raw) as SavedPosition
  } catch {
    return null
  }
}

export function savePosition(kv: KeyValue, bookId: string, position: Position): Promise<unknown> {
  return kv.set(key(bookId), JSON.stringify({ ...position, savedAt: Date.now() }))
}
