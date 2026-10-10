export interface WillPreventUnloadEventLike {
  preventDefault(): void
}

export interface WillPreventUnloadSource {
  on(event: 'will-prevent-unload', listener: (event: WillPreventUnloadEventLike) => void): void
}

/** Ignore renderer beforeunload prompts only while the application is quitting. */
export function registerQuitUnloadGuard(source: WillPreventUnloadSource, isQuitting: () => boolean): void {
  source.on('will-prevent-unload', (event) => {
    if (isQuitting()) event.preventDefault()
  })
}
