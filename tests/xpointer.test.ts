// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { blocksOf } from '../src/epub/blocks'
import { locate, parseXPointer, xpointerAt } from '../src/kosync/xpointer'

const chapter = (html: string) =>
  blocksOf(
    new DOMParser()
      .parseFromString(`<html xmlns="http://www.w3.org/1999/xhtml"><body>${html}</body></html>`, 'application/xhtml+xml')
      .getElementsByTagNameNS('*', 'body')[0],
  )

// XPointer of the first occurrence of `needle` in block `block`.
function at(html: string, needle: string, block = 0) {
  const blocks = chapter(html)
  const offset = blocks[block].text.indexOf(needle)
  expect(offset).toBeGreaterThanOrEqual(0)
  return xpointerAt(4, blocks, { block, offset })
}

describe('xpointerAt', () => {
  it('writes text().N for an element with one text node', () => {
    expect(at('<p>Call me Ishmael.</p>', 'Ishmael')).toBe('/body/DocFragment[5]/body/p/text().8')
  })

  it('names the inline element that holds the text', () => {
    expect(at('<p>Hello <em>dear</em> world</p>', 'dear')).toBe('/body/DocFragment[5]/body/p/em/text().0')
  })

  it('numbers text nodes when inline elements split the text', () => {
    expect(at('<p>Hello <em>dear</em> world</p>', 'world')).toBe('/body/DocFragment[5]/body/p/text()[2].1')
  })

  it('counts each whitespace run once, including a leading one', () => {
    expect(at('<p>Hello   \n   world</p>', 'world')).toBe('/body/DocFragment[5]/body/p/text().6')
    expect(at('<p>   Hello</p>', 'Hello')).toBe('/body/DocFragment[5]/body/p/text().1')
  })

  it('skips the whitespace-only node that opens a block when numbering', () => {
    expect(at('<p>\n  <em>x</em> tail</p>', 'tail')).toBe('/body/DocFragment[5]/body/p/text().1')
  })

  it('counts characters the glasses removed or expanded in the source', () => {
    expect(at('<p>ab\u00adcd</p>', 'cd')).toBe('/body/DocFragment[5]/body/p/text().3')
    expect(at('<p>\ufb01ne</p>', 'ne')).toBe('/body/DocFragment[5]/body/p/text().1')
  })

  it('counts raw characters inside pre', () => {
    expect(at('<pre>a   b</pre>', 'b')).toBe('/body/DocFragment[5]/body/pre/text().4')
  })

  it('uses element paths with sibling indexes', () => {
    expect(at('<div><p>One</p><p>Two three</p></div>', 'three', 1)).toBe('/body/DocFragment[5]/body/div/p[2]/text().4')
  })
})

describe('locate', () => {
  const html =
    '<div><h2>Chapter <span>One</span></h2><p>It was a <em>bright</em>   cold day in April,\n and the <b>clocks</b> were striking thirteen.</p>' +
    '<p>Winston Smith, his chin nuzzled into his breast<br/>slipped quickly through the glass doors.</p></div>'
  const blocks = chapter(html)

  it('resolves every position the glasses write back to the same character', () => {
    for (const [b, block] of blocks.entries()) {
      for (let offset = 0; offset < block.text.length; offset++) {
        if (block.text[offset] === '\n') continue
        const xp = xpointerAt(0, blocks, { block: b, offset })
        const found = locate(blocks, parseXPointer(xp)!)
        expect(found, xp).toEqual({ block: b, offset, exact: true })
      }
    }
  })

  it('resolves KOReader-style positions written elsewhere', () => {
    const find = (xp: string) => locate(blocks, parseXPointer(xp)!)
    // "clocks" is in <b>; "were" is in the third text node of the <p>.
    expect(find('/body/DocFragment[1]/body/div/p[1]/b/text().0')).toMatchObject({ block: 1, offset: blocks[1].text.indexOf('clocks') })
    expect(find('/body/DocFragment[1]/body/div/p[1]/text()[3].1')).toMatchObject({ block: 1, offset: blocks[1].text.indexOf('were') })
    // An element position lands on the start of its block.
    expect(find('/body/DocFragment[1]/body/div/p[2].0')).toEqual({ block: 2, offset: 0, exact: false })
    // A whitespace run counts once: offset 0 is the space, 1 is the "c".
    expect(find('/body/DocFragment[1]/body/div/p[1]/text()[2].0')).toMatchObject({ offset: blocks[1].text.indexOf('cold') - 1 })
    expect(find('/body/DocFragment[1]/body/div/p[1]/text()[2].1')).toMatchObject({ offset: blocks[1].text.indexOf('cold') })
  })
})
