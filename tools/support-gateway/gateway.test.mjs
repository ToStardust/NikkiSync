import assert from 'node:assert/strict'
import {once} from 'node:events'
import {test} from 'node:test'
import {createSupportGateway} from './gateway.mjs'

const report = {
  schema: 1, platform: 'android', version: '1.0.33', build: 61, osBuild: 35,
  errors: [{code: 'LIBRARY_UNREACHABLE', count: 2}]
}

async function fixture(t, visibility = 'Private') {
  const operations = []
  let issue
  const server = createSupportGateway({
    repo: 'nikkisync/support-feedback',
    token: 'synthetic-cnb-token',
    receiptSecret: Buffer.alloc(32, 1),
    replyUser: 'maintainer',
    fetchCnb: async (url, request) => {
      assert.equal(url.origin, 'https://api.cnb.cool')
      assert.equal(request.headers.Authorization, 'Bearer synthetic-cnb-token')
      const path = url.pathname.replace('/nikkisync/support-feedback', '')
      operations.push([request.method, path])
      if (path === '') return Response.json({visibility_level: visibility})
      if (path === '/-/issues' && request.method === 'POST') {
        issue = {number: '42', state: 'open', ...JSON.parse(request.body)}
        return Response.json(issue, {status: 201})
      }
      if (path === '/-/issues/42') return Response.json(issue)
      if (path === '/-/issues/42/comments') {
        assert.equal(url.searchParams.get('sort'), '-updated')
        return Response.json([
          {author: {username: 'maintainer'}, body: '维护者内部备注'},
          {author: {username: 'someone-else'}, body: '回复用户：无权发送的回复'},
          {author: {username: 'maintainer'}, body: '回复用户：修复已合入', updated_at: '2026-11-10T02:00:00Z'}
        ])
      }
      return Response.json({}, {status: 404})
    }
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => {server.closeAllConnections(); server.close()})
  const origin = 'http://127.0.0.1:' + server.address().port
  return {
    operations,
    issue: () => issue,
    submit: (payload = report) => fetch(origin + '/v1/reports', {
      method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload)
    }),
    read: (code) => fetch(origin + '/v1/replies', {headers: {Authorization: 'Bearer ' + code}})
  }
}

test('a report becomes a private issue and its receipt returns only explicit maintainer replies', async t => {
  const app = await fixture(t)
  const response = await app.submit()
  assert.equal(response.status, 201)
  const {receipt} = await response.json()
  assert.match(receipt, /^NS1\.42\./)
  assert.equal(app.issue().invisible, true)
  assert.match(app.issue().body, /LIBRARY_UNREACHABLE/)
  assert.doesNotMatch(app.issue().body, /synthetic-cnb-token/)
  const beforeInvalid = app.operations.length
  assert.equal((await app.read(receipt.replace('.42.', '.41.'))).status, 404)
  assert.equal(app.operations.length, beforeInvalid)
  const replies = await app.read(receipt)
  assert.equal(replies.status, 200)
  assert.equal(replies.headers.get('cache-control'), 'no-store')
  assert.deepEqual(await replies.json(), {
    issue: '42', closed: false, replies: [{message: '修复已合入', at: '2026-11-10T02:00:00Z'}]
  })
})

test('rejects extra report fields and unknown error codes before contacting CNB', async t => {
  const app = await fixture(t)
  assert.equal((await app.submit({...report, filename: 'private.jpg'})).status, 400)
  assert.equal((await app.submit({...report, errors: [{code: 'raw logs', count: 1}]})).status, 400)
  assert.deepEqual(app.operations, [])
})

test('a public repository cannot receive reports', async t => {
  const app = await fixture(t, 'Public')
  assert.equal((await app.submit()).status, 503)
  assert.deepEqual(app.operations, [['GET', '']])
})
