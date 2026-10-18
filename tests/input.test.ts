import { describe, expect, it } from 'vitest'
import { OsEventTypeList, type EvenHubEvent } from '@evenrealities/even_hub_sdk'
import { gestureOf, listIndexOf } from '../src/glasses/input'

const ev = (e: Record<string, { eventType?: OsEventTypeList }>) => e as EvenHubEvent

describe('gestureOf', () => {
  it('treats an envelope with no eventType as a tap', () => {
    expect(gestureOf(ev({ sysEvent: {} }))).toBe('tap')
    expect(gestureOf(ev({ textEvent: {} }))).toBe('tap')
  })

  it('does not treat a missing envelope as a tap', () => {
    expect(gestureOf(ev({}))).toBeNull()
  })

  it('prefers explicit ids over the tap fallback', () => {
    expect(gestureOf(ev({ sysEvent: { eventType: OsEventTypeList.DOUBLE_CLICK_EVENT } }))).toBe('double-tap')
    expect(gestureOf(ev({ textEvent: { eventType: OsEventTypeList.SCROLL_BOTTOM_EVENT } }))).toBe('swipe-down')
    expect(gestureOf(ev({ listEvent: { eventType: OsEventTypeList.SCROLL_TOP_EVENT } }))).toBe('swipe-up')
  })

  it('reports exits', () => {
    expect(gestureOf(ev({ sysEvent: { eventType: OsEventTypeList.SYSTEM_EXIT_EVENT } }))).toBe('exit')
    expect(gestureOf(ev({ sysEvent: { eventType: OsEventTypeList.ABNORMAL_EXIT_EVENT } }))).toBe('exit')
  })

  it('maps foreground changes and ignores other non-input events', () => {
    expect(gestureOf(ev({ sysEvent: { eventType: OsEventTypeList.FOREGROUND_ENTER_EVENT } }))).toBe('foreground')
    expect(gestureOf(ev({ sysEvent: { eventType: OsEventTypeList.FOREGROUND_EXIT_EVENT } }))).toBe('background')
    expect(gestureOf(ev({ sysEvent: { eventType: OsEventTypeList.IMU_DATA_REPORT } }))).toBeNull()
  })
})

describe('listIndexOf', () => {
  it('reads the selected row and defaults the omitted row 0', () => {
    expect(listIndexOf({ listEvent: { currentSelectItemIndex: 4 } } as EvenHubEvent)).toBe(4)
    expect(listIndexOf({ listEvent: {} } as EvenHubEvent)).toBe(0)
    expect(listIndexOf({ sysEvent: {} } as EvenHubEvent)).toBeNull()
  })
})
