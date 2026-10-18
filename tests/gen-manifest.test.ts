import { describe, expect, it } from 'vitest'
// @ts-expect-error plain JS build script
import { buildManifest, normalizeOrigin } from '../scripts/gen-manifest.mjs'
import base from '../app.json'

describe('normalizeOrigin', () => {
  it('accepts origins and strips a trailing slash', () => {
    expect(normalizeOrigin('https://books.example.org/')).toBe('https://books.example.org')
    expect(normalizeOrigin('http://10.0.0.5:8083')).toBe('http://10.0.0.5:8083')
  })

  it('rejects paths, credentials and non-http schemes', () => {
    expect(() => normalizeOrigin('https://example.org/opds')).toThrow()
    expect(() => normalizeOrigin('https://u:p@example.org')).toThrow()
    expect(() => normalizeOrigin('ftp://example.org')).toThrow()
    expect(() => normalizeOrigin('not a url')).toThrow()
  })
})

describe('buildManifest', () => {
  it('replaces only the network whitelist', () => {
    const m = buildManifest(base, 'https://books.example.org')
    expect(m.permissions.find((p: { name: string }) => p.name === 'network').whitelist).toEqual(['https://books.example.org'])
    expect({ ...m, permissions: undefined }).toEqual({ ...base, permissions: undefined })
  })
})
