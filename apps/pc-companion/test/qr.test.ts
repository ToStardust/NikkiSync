import assert from 'node:assert/strict'
import test from 'node:test'
import { qrSvg } from '../src/qr.js'
import QRCode from 'qrcode'

test('pairing payload renders as a self-contained local QR SVG', async () => {
  const payload = `NS1|server_${'a'.repeat(32)}|192.168.31.130|28080|${'b'.repeat(32)}|1788372000|${'c'.repeat(64)}`
  const svg = await qrSvg(payload)
  assert.match(svg, /^<svg /)
  assert.match(svg, /<path /)
  assert.ok(svg.length > 1000)
  const expected = await QRCode.toString(payload, { type: 'svg', errorCorrectionLevel: 'M', margin: 4, width: 512 })
  assert.equal(svg, expected)
})
