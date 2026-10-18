import {
  CreateStartUpPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
  waitForEvenAppBridge,
} from '@evenrealities/even_hub_sdk'
import { gestureOf } from './glasses/input'

const status = document.getElementById('status')!

const bridge = await waitForEvenAppBridge()

const body = { containerID: 1, containerName: 'body' }
const hint = 'Tap to count · double-tap to exit.'

const result = await bridge.createStartUpPageContainer(
  new CreateStartUpPageContainer({
    containerTotalNum: 1,
    textObject: [
      new TextContainerProperty({
        ...body,
        xPosition: 0,
        yPosition: 0,
        width: 576,
        height: 288,
        borderWidth: 0,
        paddingLength: 4,
        content: `Hello from Glass Shelf!\n${hint}`,
        isEventCapture: 1,
      }),
    ],
  }),
)
status.textContent = result === 0 ? 'Running. Check the glasses.' : `Glasses page failed (${result}).`

let taps = 0
const unsubscribe = bridge.onEvenHubEvent(event => {
  switch (gestureOf(event)) {
    case 'double-tap':
      // Root page: hand off to the host's exit dialogue (Even Hub review requirement).
      void bridge.shutDownPageContainer(1)
      break
    case 'tap':
      taps += 1
      void bridge.textContainerUpgrade(new TextContainerUpgrade({ ...body, content: `Taps: ${taps}\n${hint}` }))
      break
    case 'exit':
      unsubscribe()
      break
  }
})
