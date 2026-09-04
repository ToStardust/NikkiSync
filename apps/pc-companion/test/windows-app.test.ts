import assert from 'node:assert/strict'
import test from 'node:test'
import { DatabaseManager } from '@nikkisync/database'
import { DesktopStatusService } from '../src/desktop/DesktopStatusService.js'
import { createDesktopControlServer } from '../src/desktop/DesktopControlServer.js'

test('desktop status marks an empty device list as first run', () => {
  const database = new DatabaseManager(':memory:')
  database.initialize()
  const status = new DesktopStatusService(database).getStatus({ host: '192.168.1.8', port: 28080, assets: 12 })
  assert.deepEqual(status, {
    service: 'ready', host: '192.168.1.8', port: 28080, assets: 12, pairedDevices: 0, firstRun: true
  })
  database.close()
})

test('desktop control page shows pairing automatically only on first run', async () => {
  const createServer = (firstRun: boolean) => createDesktopControlServer({
    getStatus: () => ({ service: 'ready', host: '192.168.1.8', port: 28080, assets: 12, pairedDevices: firstRun ? 0 : 1, firstRun }),
    createPairingUri: () => 'nikki-sync://pairing-token',
    qrSvg: async () => '<svg data-test="qr"></svg>'
  })
  const firstRunServer = createServer(true)
  const pairedServer = createServer(false)
  await Promise.all([
    new Promise<void>((resolve) => firstRunServer.listen(0, '127.0.0.1', resolve)),
    new Promise<void>((resolve) => pairedServer.listen(0, '127.0.0.1', resolve))
  ])
  try {
    const firstPort = (firstRunServer.address() as { port: number }).port
    const pairedPort = (pairedServer.address() as { port: number }).port
    const firstHtml = await (await fetch(`http://127.0.0.1:${firstPort}/`)).text()
    const pairedHtml = await (await fetch(`http://127.0.0.1:${pairedPort}/`)).text()
    assert.match(firstHtml, /data-test="qr"/)
    assert.match(firstHtml, /首次配对/)
    assert.doesNotMatch(pairedHtml, /data-test="qr"/)
    assert.match(pairedHtml, /生成新二维码/)
    const renewed = await fetch(`http://127.0.0.1:${pairedPort}/api/pairing`, { method: 'POST' })
    assert.equal(renewed.status, 200)
    assert.equal((await renewed.json() as { qrSvg: string }).qrSvg, '<svg data-test="qr"></svg>')
  } finally {
    await Promise.all([
      new Promise<void>((resolve) => firstRunServer.close(() => resolve())),
      new Promise<void>((resolve) => pairedServer.close(() => resolve()))
    ])
  }
})
