import {
  CreateStartUpPageContainer,
  ListContainerProperty,
  ListItemContainerProperty,
  RebuildPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
  type EvenAppBridge,
} from '@evenrealities/even_hub_sdk'
import { devlog } from '../devlog'

export const WIDTH = 576
export const HEIGHT = 288
const HEADER_HEIGHT = 36
const PADDING = 4

// Reader layout: 9 lines of body (9 × 27 px + padding) over a 1-line footer.
const BODY_HEIGHT = 252
const FOOTER_Y = 256
// Text wraps a few pixels narrower than the inner box: the simulator kept
// lines up to 563 px but wrapped 566 px ones that pretext measured as fitting.
// Measuring against a slightly narrower box keeps pages from overflowing.
const WRAP_MARGIN = 8
export const READER_BOX = { width: WIDTH - 2 * PADDING - WRAP_MARGIN, height: BODY_HEIGHT - 2 * PADDING }
export const FOOTER_WIDTH = WIDTH - 2 * PADDING

export type Page =
  | { kind: 'message'; text: string }
  | { kind: 'list'; title: string; items: string[] }
  | { kind: 'reader'; body: string; footer: string }

// A bridge call that has not answered by then is abandoned, so one lost
// reply (e.g. while the phone app is suspended) cannot block every later one.
const CALL_TIMEOUT_MS = 5000

export class Renderer {
  // Startup is one-shot per session: a retry is rejected after blocking ~2 s.
  // Latch that it was called, not that it succeeded (page-lifecycle.md).
  private started = false
  // Page commands run one at a time, in order: overlapping rebuilds (from
  // duplicate host events) are a likely way to confuse the host.
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly bridge: EvenAppBridge) {}

  private run<T>(label: string, call: () => Promise<T>): Promise<T | null> {
    const task = this.queue.then(async () => {
      const started = performance.now()
      const result = await Promise.race([
        call(),
        new Promise<null>(resolve => setTimeout(() => resolve(null), CALL_TIMEOUT_MS)),
      ])
      devlog('[bridge]', label, '->', result, `${Math.round(performance.now() - started)}ms`)
      return result
    })
    this.queue = task.catch(() => null)
    return task
  }

  async show(page: Page): Promise<boolean> {
    const containers =
      page.kind === 'message'
        ? messagePage(page.text)
        : page.kind === 'list'
          ? listPage(page.title, page.items)
          : readerPage(page.body, page.footer)
    if (!this.started) {
      this.started = true
      const result = await this.run(`startup ${page.kind}`, () =>
        this.bridge.createStartUpPageContainer(new CreateStartUpPageContainer(containers)),
      )
      if (result === 0) return true
    }
    return (await this.run(`rebuild ${page.kind}`, () =>
      this.bridge.rebuildPageContainer(new RebuildPageContainer(containers)),
    )) === true
  }

  // Updates the reader in place: flicker-free, unlike a rebuild. Callers must
  // have shown a reader page first.
  async updateReader(body: string | null, footer: string | null): Promise<void> {
    if (body !== null) {
      await this.run('upgrade body', () =>
        this.bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: 1, containerName: 'body', content: body })),
      )
    }
    if (footer !== null) {
      await this.run('upgrade footer', () =>
        this.bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: 2, containerName: 'footer', content: footer })),
      )
    }
  }

  shutDown(): Promise<unknown> {
    return this.run('shutdown', () => this.bridge.shutDownPageContainer(1))
  }
}

function readerPage(body: string, footer: string) {
  return {
    containerTotalNum: 2,
    textObject: [
      new TextContainerProperty({
        xPosition: 0,
        yPosition: 0,
        width: WIDTH,
        height: BODY_HEIGHT,
        borderWidth: 0,
        paddingLength: PADDING,
        containerID: 1,
        containerName: 'body',
        content: body,
        isEventCapture: 1,
      }),
      new TextContainerProperty({
        xPosition: 0,
        yPosition: FOOTER_Y,
        width: WIDTH,
        height: HEIGHT - FOOTER_Y,
        borderWidth: 0,
        paddingLength: 2,
        containerID: 2,
        containerName: 'footer',
        content: footer,
        isEventCapture: 0,
      }),
    ],
  }
}

function messagePage(text: string) {
  return {
    containerTotalNum: 1,
    textObject: [
      new TextContainerProperty({
        xPosition: 0,
        yPosition: 0,
        width: WIDTH,
        height: HEIGHT,
        borderWidth: 0,
        paddingLength: 8,
        containerID: 1,
        containerName: 'message',
        content: text,
        isEventCapture: 1,
      }),
    ],
  }
}

function listPage(title: string, items: string[]) {
  return {
    containerTotalNum: 2,
    textObject: [
      new TextContainerProperty({
        xPosition: 0,
        yPosition: 0,
        width: WIDTH,
        height: HEADER_HEIGHT,
        borderWidth: 0,
        paddingLength: 4,
        containerID: 1,
        containerName: 'header',
        content: title,
        isEventCapture: 0,
      }),
    ],
    listObject: [
      new ListContainerProperty({
        xPosition: 0,
        yPosition: HEADER_HEIGHT,
        width: WIDTH,
        height: HEIGHT - HEADER_HEIGHT,
        borderWidth: 0,
        paddingLength: 4,
        containerID: 2,
        containerName: 'list',
        isEventCapture: 1,
        itemContainer: new ListItemContainerProperty({
          itemCount: items.length,
          itemWidth: 0,
          isItemSelectBorderEn: 1,
          itemName: items,
        }),
      }),
    ],
  }
}
