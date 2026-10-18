import { OsEventTypeList, type EvenHubEvent } from '@evenrealities/even_hub_sdk'

export type Gesture = 'tap' | 'double-tap' | 'swipe-up' | 'swipe-down' | 'foreground' | 'background' | 'exit'

// CLICK_EVENT is 0 and protobuf drops zero-value fields, so a tap arrives as an
// envelope with no eventType. Default it inside the envelope check: an absent
// envelope is not a tap.
function eventTypeOf(envelope?: { eventType?: OsEventTypeList }): OsEventTypeList | null {
  if (!envelope) return null
  return envelope.eventType ?? OsEventTypeList.CLICK_EVENT
}

// Maps a raw bridge event to a gesture. Hardware reports taps on the capturing
// container's envelope (text/list); the simulator uses sysEvent. Explicit ids
// are matched before the CLICK fallback.
export function gestureOf(event: EvenHubEvent): Gesture | null {
  const types = [event.sysEvent, event.textEvent, event.listEvent].map(eventTypeOf)
  const has = (t: OsEventTypeList) => types.includes(t)

  if (has(OsEventTypeList.SYSTEM_EXIT_EVENT) || has(OsEventTypeList.ABNORMAL_EXIT_EVENT)) return 'exit'
  if (has(OsEventTypeList.FOREGROUND_ENTER_EVENT)) return 'foreground'
  if (has(OsEventTypeList.FOREGROUND_EXIT_EVENT)) return 'background'
  if (has(OsEventTypeList.DOUBLE_CLICK_EVENT)) return 'double-tap'
  if (has(OsEventTypeList.SCROLL_BOTTOM_EVENT)) return 'swipe-down'
  if (has(OsEventTypeList.SCROLL_TOP_EVENT)) return 'swipe-up'
  if (has(OsEventTypeList.CLICK_EVENT)) return 'tap'
  return null
}

// Selected row of a list event. The firmware omits the index for row 0.
export function listIndexOf(event: EvenHubEvent): number | null {
  if (!event.listEvent) return null
  return event.listEvent.currentSelectItemIndex ?? 0
}
