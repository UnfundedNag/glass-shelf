// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { blocksOf } from '../src/epub/blocks'
import { EpubError, loadEpub } from '../src/epub/book'
import { normalizeText } from '../src/epub/text'
import { makeEpub } from './helpers/epub'

const blocks = (html: string) => blocksOf(body(html)).map(({ path, text }) => ({ path, text }))
const body = (html: string) =>
  new DOMParser().parseFromString(`<html xmlns="http://www.w3.org/1999/xhtml"><body>${html}</body></html>`, 'application/xhtml+xml')
    .getElementsByTagNameNS('*', 'body')[0]

describe('blocksOf', () => {
  it('addresses blocks with CREngine-style paths', () => {
    expect(blocks('<div><p>One</p><p>Two</p></div><p>Three</p>')).toEqual([
      { path: '/body/div/p[1]', text: 'One' },
      { path: '/body/div/p[2]', text: 'Two' },
      { path: '/body/p', text: 'Three' },
    ])
  })

  it('counts siblings by element name, including empty ones', () => {
    expect(blocks('<div></div><div><h2>T</h2><p></p><p>x</p></div>').map(b => b.path)).toEqual([
      '/body/div[2]/h2',
      '/body/div[2]/p[2]',
    ])
  })

  it('collapses whitespace, keeps <br> line breaks and keeps inline markup text', () => {
    expect(blocks('<p>  Hello\n   <em>dear</em>   world<br/>second  line </p>')[0].text).toBe(
      'Hello dear world\nsecond line',
    )
  })

  it('skips scripts, styles and images', () => {
    expect(blocks('<p>a<script>x()</script><img src="i.png"/>b</p><style>p{}</style>')).toEqual([
      { path: '/body/p', text: 'ab' },
    ])
  })

  it('emits text mixed between block children as blocks of the parent', () => {
    expect(blocks('<div>Intro <b>bold</b><p>Para</p>Outro</div>')).toEqual([
      { path: '/body/div', text: 'Intro bold' },
      { path: '/body/div/p', text: 'Para' },
      { path: '/body/div', text: 'Outro' },
    ])
  })
})

describe('normalizeText', () => {
  it('fixes characters the G2 font lacks or would draw wrongly', () => {
    expect(normalizeText('\ufb01ne \ufb02ow\u00adered\u200bword\u2009x')).toBe('fine floweredword x')
  })
})

describe('loadEpub', () => {
  it('reads the spine in order, keeping empty items so indexes match DocFragment', async () => {
    const book = await loadEpub(
      await makeEpub({ title: 'Book', chapters: ['<img src="cover.jpg"/>', '<p>First</p>', '<h1>Two</h1><p>Second</p>'] }),
    )
    expect(book.title).toBe('Book')
    expect(book.chapters.map(c => [c.spineIndex, c.chars])).toEqual([[0, 0], [1, 5], [2, 9]])
    expect(book.totalChars).toBe(14)
  })

  it('falls back to the HTML parser for malformed chapters', async () => {
    const zipped = await makeEpub({ chapters: ['<p>Unclosed<br><p>Next &nbsp; one'] })
    const book = await loadEpub(zipped)
    expect(book.chapters[0].blocks.map(b => b.text)).toEqual(['Unclosed', 'Next one'])
  })

  it('rejects DRM but accepts font obfuscation', async () => {
    const enc = (alg: string) =>
      `<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#"><enc:EncryptedData><enc:EncryptionMethod Algorithm="${alg}"/></enc:EncryptedData></encryption>`
    await expect(
      loadEpub(await makeEpub({ chapters: ['<p>x</p>'], encryption: enc('http://www.w3.org/2001/04/xmlenc#aes128-cbc') })),
    ).rejects.toThrow('DRM')
    await expect(
      loadEpub(await makeEpub({ chapters: ['<p>x</p>'], encryption: enc('http://www.idpf.org/2008/embedding') })),
    ).resolves.toBeTruthy()
  })

  it('rejects files that are not EPUBs, or have no text', async () => {
    await expect(loadEpub(new TextEncoder().encode('not a zip').buffer)).rejects.toBeInstanceOf(EpubError)
    await expect(loadEpub(await makeEpub({ chapters: ['<img src="a.png"/>'] }))).rejects.toThrow('no readable text')
  })
})
