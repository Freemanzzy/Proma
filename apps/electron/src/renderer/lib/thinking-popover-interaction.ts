export interface ThinkingPopoverClickEvent {
  defaultPrevented: boolean
  preventDefault(): void
}

export function isTouchInput(maxTouchPoints: number | undefined, coarsePointer: boolean): boolean {
  return (typeof maxTouchPoints === 'number' && maxTouchPoints > 0) || coarsePointer
}

export function shouldOpenThinkingPopoverOnTouch(
  isWebRemote: boolean,
  maxTouchPoints: number | undefined,
  coarsePointer: boolean,
): boolean {
  return isWebRemote && isTouchInput(maxTouchPoints, coarsePointer)
}

export function handleThinkingPopoverTriggerClick(
  event: ThinkingPopoverClickEvent,
  openOnTouch: boolean,
  setOpen: (next: boolean | ((previous: boolean) => boolean)) => void,
  onDesktopClick: () => void,
): void {
  if (openOnTouch) {
    event.preventDefault()
    setOpen(true)
    return
  }
  onDesktopClick()
}
