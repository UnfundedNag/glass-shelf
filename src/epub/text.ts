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

export function normalizeText(s: string): string {
  return (
    s
      // Soft hyphens, zero-width spaces/joiners and BOMs: invisible in print.
      .replace(/[\u00ad\u200b-\u200d\u2060\ufeff]/g, '')
      // Typographic spaces become plain spaces: the font lacks most of them,
      // and the firmware does not honour no-break spaces when wrapping.
      .replace(/[\u00a0\u2000-\u200a\u202f\u205f]/g, ' ')
      .replace(/[\ufb00-\ufb06]/g, ch => LIGATURES[ch] ?? ch)
  )
}

// Collapses HTML whitespace runs to one space, keeping explicit newlines
// (from <br>) as line breaks.
export function collapseWhitespace(s: string): string {
  return s
    .split('\n')
    .map(line => line.replace(/[ \t\r\f]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
