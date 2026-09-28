import { MOBILE_CSS } from './mobile-patch/mobile-css'
import { MOBILE_JS } from './mobile-patch/mobile-js'

export function renderWebRemoteMobilePatch(): string {
  return `<style id="proma-web-remote-mobile-style">\n${MOBILE_CSS}\n</style>\n<script nonce="__PROMA_NONCE__">\n${MOBILE_JS}\n</script>`
}
