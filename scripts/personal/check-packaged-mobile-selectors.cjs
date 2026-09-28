#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const asar = require('@electron/asar')

const target = process.argv[2]
if (!target) {
  console.error('Usage: node check-packaged-mobile-selectors.cjs <dist/main.cjs|app.asar>')
  process.exit(2)
}

let source
if (target.endsWith('.asar')) {
  source = asar.extractFile(target, 'dist/main.cjs').toString('utf8')
} else {
  source = fs.readFileSync(path.resolve(target), 'utf8')
}

const required = [
  'button[aria-label="打开设置"]',
  '[data-web-remote-panel="right"]',
  '[data-web-remote-sidebar="left"]',
]
const missing = required.filter((selector) => !source.includes(selector))
const escapedChineseSelector = 'button[aria-label="\\u6253\\u5F00\\u8BBE\\u7F6E"]'
if (missing.length || source.includes(escapedChineseSelector)) {
  if (missing.length) console.error(`Missing raw mobile selectors: ${missing.join(', ')}`)
  if (source.includes(escapedChineseSelector)) console.error('Mobile selector contains escaped Unicode instead of raw Chinese characters.')
  process.exit(1)
}
console.log(`Mobile selector packaging check passed (${required.length} raw selectors): ${target}`)
