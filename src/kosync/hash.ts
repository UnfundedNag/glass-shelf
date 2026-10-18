import SparkMD5 from 'spark-md5'

// KOReader's document fingerprint (util.partialMD5): MD5 over 1 KB samples
// at offsets 0, 1 KB, 4 KB, 16 KB, ... 1 GB, stopping at end of file. Lua's
// lshift(1024, -2) and JS's 1024 << -2 both wrap to 0, so the first sample is
// at 0. Readest uses the same scheme. Must run on the exact bytes Readest has.
export function koPartialMd5(bytes: ArrayBuffer): string {
  const step = 1024
  const size = 1024
  const md5 = new SparkMD5.ArrayBuffer()
  for (let i = -1; i <= 10; i++) {
    const offset = step << (2 * i)
    if (offset >= bytes.byteLength) break
    md5.append(bytes.slice(offset, offset + size))
  }
  return md5.end()
}
