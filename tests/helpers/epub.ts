import JSZip from 'jszip'

export type EpubSpec = {
  title?: string
  // Chapter bodies (the inside of <body>), in spine order.
  chapters: string[]
  encryption?: string
  // Index of the chapter to mark as the EPUB 3 nav document.
  nav?: number
}

// Builds a minimal EPUB in memory.
export async function makeEpub({ title = 'Test Book', chapters, encryption, nav }: EpubSpec): Promise<ArrayBuffer> {
  const zip = new JSZip()
  zip.file('mimetype', 'application/epub+zip')
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
  )
  if (encryption) zip.file('META-INF/encryption.xml', encryption)
  const items = chapters.map(
    (_, i) =>
      `<item id="c${i}" href="text/ch${i}.xhtml" media-type="application/xhtml+xml"${i === nav ? ' properties="nav"' : ''}/>`,
  )
  const refs = chapters.map((_, i) => `<itemref idref="c${i}"/>`)
  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${title}</dc:title><dc:identifier id="id">x</dc:identifier></metadata>
<manifest>${items.join('')}</manifest><spine>${refs.join('')}</spine></package>`,
  )
  chapters.forEach((body, i) =>
    zip.file(
      `OEBPS/text/ch${i}.xhtml`,
      `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>c</title></head><body>${body}</body></html>`,
    ),
  )
  return zip.generateAsync({ type: 'arraybuffer' })
}

export const LOREM =
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.'
