import type { Position } from '../reader/reader'
import type { KeyValue } from './settings'

// Local reading positions, one per book, keyed by the KOReader document hash
// (the same key the sync server uses).
export type SavedPosition = Position & { savedAt: number }

const key = (document: string) => `pos:${document}`

export async function loadPosition(kv: KeyValue, document: string): Promise<SavedPosition | null> {
  const raw = await kv.get(key(document))
  if (!raw) return null
  try {
    return JSON.parse(raw) as SavedPosition
  } catch {
    return null
  }
}

export function savePosition(kv: KeyValue, document: string, position: Position): Promise<unknown> {
  return kv.set(key(document), JSON.stringify({ ...position, savedAt: Date.now() }))
}
