const encoder = new TextEncoder()

// List items are capped at 63 UTF-8 bytes (the simulator enforces bytes, the
// docs say 64 characters; bytes is the stricter of the two).
export function clipBytes(s: string, max = 63): string {
  const clean = s.replace(/\s+/g, ' ').trim()
  if (encoder.encode(clean).length <= max) return clean
  const ellipsis = '…'
  const budget = max - encoder.encode(ellipsis).length
  let out = ''
  let used = 0
  for (const ch of clean) {
    const n = encoder.encode(ch).length
    if (used + n > budget) break
    out += ch
    used += n
  }
  return out.trimEnd() + ellipsis
}
