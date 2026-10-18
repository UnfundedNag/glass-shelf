// Normalizes text for the G2 font. The firmware silently drops glyphs it
// lacks, and it draws soft hyphens, so fix the common EPUB cases up front.
const LIGATURES: Record<string, string> = {
  '\ufb00': 'ff',
  '\ufb01': 'fi',
  '\ufb02': 'fl',
  '\ufb03': 'ffi',
  '\ufb04': 'ffl',
  '\ufb05': 'st',
  '\ufb06': 'st',
}

// Replacement for one source character: '' drops it.
export function normalizeChar(ch: string): string {
  // Soft hyphens, zero-width spaces/joiners and BOMs: invisible in print.
  if (/[\u00ad\u200b-\u200d\u2060\ufeff]/.test(ch)) return ''
  // Typographic spaces become plain spaces: the font lacks most of them, and
  // the firmware does not honour no-break spaces when wrapping. Newlines in
  // markup are plain whitespace too; only <br> breaks a line.
  if (/[\n\r\u00a0\u2000-\u200a\u202f\u205f]/.test(ch)) return ' '
  return LIGATURES[ch] ?? ch
}

export function normalizeText(s: string): string {
  return Array.from(s, normalizeChar).join('')
}
