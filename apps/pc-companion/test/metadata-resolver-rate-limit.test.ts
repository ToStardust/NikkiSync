import assert from 'node:assert/strict'
import http from 'node:http'
import test from 'node:test'
import { Nuan5CompatibleResolver } from '../src/metadata/Nuan5CompatibleResolver.js'

const payload = Buffer.from('payload-segment').toString('base64')
const token = Buffer.from('hash-segment').toString('base64')
const md5 = '0123456789abcdef0123456789abcdef'

function requestFor(uid: string) {
  return {
    assetId: `asset_${uid}`,
    uid,
    nativeParamPayload: payload,
    nativeParamToken: token,
    nativeParamNuan5Md5: md5
  }
}

async function listen(server: http.Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return (server.address() as { port: number }).port
}

async function close(server: http.Server): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()))
}

test('NUAN5 resolver retries HTTP 429 up to the configured limit', async () => {
  let calls = 0
  const server = http.createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { photos: Record<string, unknown> }
    const uid = Object.keys(body.photos)[0]!
    calls++
    if (calls <= 2) {
      response.statusCode = 429
      response.end('rate limited')
      return
    }
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify([[uid, [{ focal: 35, clothes: [101] }]]]))
  })
  const port = await listen(server)
  try {
    const resolver = new Nuan5CompatibleResolver({
      endpoint: `http://127.0.0.1:${port}/api/decode-photo2`,
      minRequestIntervalMs: 0,
      maxRateLimitRetries: 2
    } as any)
    const result = await resolver.resolve(requestFor('10001'))
    assert.equal(calls, 3)
    assert.equal(result.metadata.camera?.focalLength, 35)
    assert.deepEqual(result.metadata.dressing?.clothes, [101])
  } finally {
    await close(server)
  }
})

test('NUAN5 resolver spaces consecutive sends by the configured minimum interval', async () => {
  const receivedAt: number[] = []
  const server = http.createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { photos: Record<string, unknown> }
    const uid = Object.keys(body.photos)[0]!
    receivedAt.push(Date.now())
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify([[uid, [{ focal: 50 }]]]))
  })
  const port = await listen(server)
  try {
    const resolver = new Nuan5CompatibleResolver({
      endpoint: `http://127.0.0.1:${port}/api/decode-photo2`,
      minRequestIntervalMs: 40,
      maxRateLimitRetries: 0
    } as any)
    await Promise.all([
      resolver.resolve(requestFor('10001')),
      resolver.resolve(requestFor('10002'))
    ])
    assert.equal(receivedAt.length, 2)
    assert.ok(receivedAt[1]! - receivedAt[0]! >= 30, `requests were only ${receivedAt[1]! - receivedAt[0]!}ms apart`)
  } finally {
    await close(server)
  }
})
