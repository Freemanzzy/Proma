import { describe, expect, test } from 'bun:test'
import { composeEventHandlers } from '@radix-ui/primitive'
import { handleThinkingPopoverTriggerClick, shouldOpenThinkingPopoverOnTouch } from '@/lib/thinking-popover-interaction'

type MockClickEvent = {
  defaultPrevented: boolean
  preventDefault(): void
}

function clickThroughRadixTrigger(
  openOnTouch: boolean,
  onDesktopClick: () => void,
): { open: boolean; event: MockClickEvent } {
  let open = false
  const setOpen = (next: boolean | ((previous: boolean) => boolean)): void => {
    open = typeof next === 'function' ? next(open) : next
  }
  const event: MockClickEvent = {
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true },
  }
  const triggerOnClick = composeEventHandlers(
    (clickEvent: MockClickEvent) => handleThinkingPopoverTriggerClick(clickEvent, openOnTouch, setOpen, onDesktopClick),
    () => setOpen((previous) => !previous),
  )
  triggerOnClick(event)
  return { open, event }
}

describe('Web Remote touch thinking control', () => {
  test('Radix trigger click leaves the touch popover open and skips both desktop thinking callbacks', () => {
    expect(shouldOpenThinkingPopoverOnTouch(true, 5, false)).toBe(true)
    expect(shouldOpenThinkingPopoverOnTouch(true, 0, true)).toBe(true)
    expect(shouldOpenThinkingPopoverOnTouch(false, 5, true)).toBe(false)

    let onToggleCalls = 0
    let onThinkingLevelChangeCalls = 0
    const toggleResult = clickThroughRadixTrigger(
      shouldOpenThinkingPopoverOnTouch(true, 5, false),
      () => { onToggleCalls += 1 },
    )
    const thinkingResult = clickThroughRadixTrigger(
      shouldOpenThinkingPopoverOnTouch(true, 5, false),
      () => { onThinkingLevelChangeCalls += 1 },
    )

    expect(toggleResult.open).toBe(true)
    expect(toggleResult.event.defaultPrevented).toBe(true)
    expect(thinkingResult.open).toBe(true)
    expect(thinkingResult.event.defaultPrevented).toBe(true)
    expect(onToggleCalls).toBe(0)
    expect(onThinkingLevelChangeCalls).toBe(0)
  })

  test('desktop click is not prevented, toggles Radix open state, and invokes the desktop action', () => {
    let desktopCalls = 0
    const result = clickThroughRadixTrigger(false, () => { desktopCalls += 1 })
    expect(result.open).toBe(true)
    expect(result.event.defaultPrevented).toBe(false)
    expect(desktopCalls).toBe(1)
  })
})
