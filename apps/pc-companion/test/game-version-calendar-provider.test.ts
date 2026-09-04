import assert from 'node:assert/strict'
import http from 'node:http'
import test from 'node:test'
import { AppSettingsRepository, DatabaseManager } from '@nikkisync/database'
import { GameVersionCalendarStore } from '../src/game-version/GameVersionCalendarStore.js'
import { GameVersionCalendarUpdateService } from '../src/game-version/GameVersionCalendarUpdateService.js'
import { RemoteJsonGameVersionCalendarProvider } from '../src/game-version/RemoteJsonGameVersionCalendarProvider.js'

test('remote calendar update uses conditional GET and replaces the cached snapshot without photo identifiers', async () => {
  const db = new DatabaseManager(':memory:')
  db.initialize()
  const store = new GameVersionCalendarStore(new AppSettingsRepository(db))
  store.replace({
    schemaVersion: 1, provider: 'fixture-calendar', providerVersion: '1',
    sourceUrls: ['https://official.example.test/v1'],
    entries: [{ version: '2.8', availableAt: '2026-07-17T03:00:00.000Z' }]
  })

  const requests: Array<{ headers: http.IncomingHttpHeaders; body: string }> = []
  const modified = 'Fri, 28 Aug 2026 03:00:00 GMT'
  const server = http.createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    requests.push({ headers: request.headers, body: Buffer.concat(chunks).toString('utf8') })
    if (request.headers['if-none-match'] === '"calendar-v2"') {
      response.writeHead(304); response.end(); return
    }
    response.setHeader('content-type', 'application/json')
    response.setHeader('etag', '"calendar-v2"')
    response.setHeader('last-modified', modified)
    response.end(JSON.stringify({
      schemaVersion: 1,
      provider: 'fixture-calendar',
      providerVersion: '2',
      generatedAt: '2026-08-28T03:05:00.000Z',
      sourceUrls: ['https://official.example.test/v2'],
      entries: [
        { version: '2.8', availableAt: '2026-07-17T03:00:00.000Z' },
        { version: '2.9', availableAt: '2026-08-28T03:00:00.000Z' }
      ]
    }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address() as { port: number }
    const provider = new RemoteJsonGameVersionCalendarProvider({
      id: 'fixture-calendar', endpoint: `http://127.0.0.1:${address.port}/calendar`
    })
    const updater = new GameVersionCalendarUpdateService(db, store, provider)

    assert.deepEqual(await updater.runOnce(), { status: 'updated' })
    assert.equal(store.resolve('2026-09-01T00:00:00.000Z'), '2.9')
    assert.equal(requests[0]?.body, '')
    assert.equal(JSON.stringify(requests[0]).includes('asset'), false)
    assert.equal(JSON.stringify(requests[0]).includes('uid'), false)

    assert.deepEqual(await updater.runOnce(), { status: 'not-modified' })
    assert.equal(requests[1]?.headers['if-none-match'], '"calendar-v2"')
    assert.equal(requests[1]?.headers['if-modified-since'], modified)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    db.close()
  }
})

test('failed remote calendar update preserves the previous valid snapshot', async () => {
  const db = new DatabaseManager(':memory:')
  db.initialize()
  const store = new GameVersionCalendarStore(new AppSettingsRepository(db))
  store.replace({
    schemaVersion: 1, provider: 'fixture-calendar', providerVersion: '1',
    sourceUrls: ['https://official.example.test/v1'],
    entries: [{ version: '2.8', availableAt: '2026-07-17T03:00:00.000Z' }]
  })
  const server = http.createServer((_request, response) => {
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({
      schemaVersion: 1, provider: 'wrong-provider', providerVersion: '2',
      sourceUrls: ['https://official.example.test/v2'],
      entries: [{ version: '2.9', availableAt: '2026-08-28T03:00:00.000Z' }]
    }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address() as { port: number }
    const updater = new GameVersionCalendarUpdateService(
      db,
      store,
      new RemoteJsonGameVersionCalendarProvider({
        id: 'fixture-calendar', endpoint: `http://127.0.0.1:${address.port}/calendar`
      })
    )
    const result = await updater.runOnce()
    assert.equal(result.status, 'failed')
    assert.match(result.status === 'failed' ? result.error : '', /provider/i)
    assert.equal(store.manifest()?.providerVersion, '1')
    assert.equal(store.resolve('2026-09-01T00:00:00.000Z'), '2.8')
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    db.close()
  }
})

test('remote calendar rejects non-UTC availability boundaries instead of silently normalizing them', async () => {
  const server = http.createServer((_request, response) => {
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({
      schemaVersion: 1, provider: 'fixture-calendar', providerVersion: '1',
      sourceUrls: ['https://official.example.test/v1'],
      entries: [{ version: '2.9', availableAt: '2026-08-28T11:00:00+08:00' }]
    }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address() as { port: number }
    const provider = new RemoteJsonGameVersionCalendarProvider({
      id: 'fixture-calendar', endpoint: `http://127.0.0.1:${address.port}/calendar`
    })
    await assert.rejects(provider.fetch(), /UTC|availableAt/i)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
