import { getTextWidth } from '@evenrealities/pretext'
import type { View } from '../reader/reader'

const BAR_SEGMENTS = 12

// "━━━━━─────── Ch 7/24 · 47% · 12:41", trimmed to fit one line.
export function footerText(view: View, now: Date, width: number): string {
  const percent = Math.floor(view.percentage * 100)
  const filled = Math.round(view.percentage * BAR_SEGMENTS)
  const bar = '━'.repeat(filled) + '─'.repeat(BAR_SEGMENTS - filled)
  const time = `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`
  const status = view.atEnd ? 'End of book' : `Ch ${view.chapter}/${view.chapters} · ${percent}%`
  const full = `${bar}  ${status} · ${time}`
  return getTextWidth(full) <= width ? full : `${status} · ${time}`
}
