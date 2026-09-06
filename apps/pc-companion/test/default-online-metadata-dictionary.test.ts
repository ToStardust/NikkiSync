import assert from 'node:assert/strict'
import http from 'node:http'
import test from 'node:test'
import { DefaultOnlineMetadataDictionaryProvider } from '../src/metadata/DefaultOnlineMetadataDictionaryProvider.js'

async function listen(server: http.Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return (server.address() as { port: number }).port
}

async function close(server: http.Server): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()))
}

test('default online dictionary combines NUAN5 camera names with clothing item IDs', async () => {
  const server = http.createServer((request, response) => {
    response.setHeader('content-type', 'application/json; charset=utf-8')
    if (request.url === '/camera.json') {
      response.end(JSON.stringify({
        v: 'camera-v1',
        d: {
          filters: {
            '7': { zh: '晨雾', en: 'Morning Mist', icon: 'https://example.test/filter-7.png' }
          },
          lights: {
            '3': { zh: '柔光', en: 'Soft Light' }
          },
          poses: {
            '9': { zh: '回眸', en: 'Look Back' }
          }
        }
      }))
      return
    }
    if (request.url === '/item.json') {
      response.end(JSON.stringify({
        'item.1020100111.name': '馥郁时花',
        'item.1020100112.name': '和风轻抚',
        'item.invalid.name': 'ignore me',
        'other.1020100113.name': 'ignore me too'
      }))
      return
    }
    response.statusCode = 404
    response.end('not found')
  })
  const port = await listen(server)
  try {
    const provider = new DefaultOnlineMetadataDictionaryProvider({
      cameraEndpoint: `http://127.0.0.1:${port}/camera.json`,
      clothingEndpoint: `http://127.0.0.1:${port}/item.json`
    })
    const result = await provider.fetch()
    assert.equal(result.status, 'updated')
    if (result.status !== 'updated') throw new Error('expected updated dictionary')

    assert.equal(result.manifest.provider, 'nikkisync-default-online')
    const byKey = new Map(result.manifest.entries.map((entry) => [`${entry.kind}:${entry.id}`, entry]))
    assert.equal(byKey.get('clothing:1020100111')?.name, '馥郁时花')
    assert.equal(byKey.get('clothing:1020100111')?.thumbnail, 'https://gongeo.us/images/items/icons/1020100111.png')
    assert.equal(byKey.get('clothing:1020100112')?.name, '和风轻抚')
    assert.equal(byKey.get('filter:7')?.name, '晨雾')
    assert.equal(byKey.get('filter:7')?.thumbnail, 'https://example.test/filter-7.png')
    assert.equal(byKey.get('lighting:3')?.name, '柔光')
    assert.equal(byKey.get('pose:9')?.name, '回眸')
    assert.equal(byKey.has('clothing:invalid'), false)
  } finally {
    await close(server)
  }
})

test('default online dictionary returns not-modified when combined content fingerprint is unchanged', async () => {
  const server = http.createServer((request, response) => {
    response.setHeader('content-type', 'application/json')
    response.end(request.url === '/camera.json'
      ? JSON.stringify({ v: 'camera-v1', d: { filters: {} } })
      : JSON.stringify({ 'item.1020100111.name': '馥郁时花' }))
  })
  const port = await listen(server)
  try {
    const provider = new DefaultOnlineMetadataDictionaryProvider({
      cameraEndpoint: `http://127.0.0.1:${port}/camera.json`,
      clothingEndpoint: `http://127.0.0.1:${port}/item.json`
    })
    const first = await provider.fetch()
    assert.equal(first.status, 'updated')
    if (first.status !== 'updated' || !first.etag) throw new Error('expected first update with fingerprint')
    const second = await provider.fetch({ etag: first.etag })
    assert.equal(second.status, 'not-modified')
  } finally {
    await close(server)
  }
})
