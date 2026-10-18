import {
  CreateStartUpPageContainer,
  ListContainerProperty,
  ListItemContainerProperty,
  RebuildPageContainer,
  TextContainerProperty,
  type EvenAppBridge,
} from '@evenrealities/even_hub_sdk'

export const WIDTH = 576
export const HEIGHT = 288
const HEADER_HEIGHT = 36

export type Page = { kind: 'message'; text: string } | { kind: 'list'; title: string; items: string[] }

export class Renderer {
  // Startup is one-shot per session: a retry is rejected after blocking ~2 s.
  // Latch that it was called, not that it succeeded (page-lifecycle.md).
  private started = false

  constructor(private readonly bridge: EvenAppBridge) {}

  async show(page: Page): Promise<boolean> {
    const containers = page.kind === 'message' ? messagePage(page.text) : listPage(page.title, page.items)
    if (!this.started) {
      this.started = true
      const result = await this.bridge.createStartUpPageContainer(new CreateStartUpPageContainer(containers))
      if (result === 0) return true
    }
    return this.bridge.rebuildPageContainer(new RebuildPageContainer(containers))
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
