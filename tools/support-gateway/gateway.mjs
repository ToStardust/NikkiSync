import {createHmac, randomBytes, timingSafeEqual} from 'node:crypto'
import {createServer} from 'node:http'
import {pathToFileURL} from 'node:url'

const androidCodes = new Set([
  'PAIR_FAILED', 'LIBRARY_UNREACHABLE', 'LIBRARY_REJECTED', 'LIBRARY_CERTIFICATE', 'SHARE_EXPORT',
  'UPDATE_CHECK', 'UPDATE_SIGNATURE', 'UPDATE_DOWNLOAD', 'UPDATE_APK_VERIFY', 'UPDATE_INSTALL'
])
const windowsCodes = new Set([
  'GAME_NOT_FOUND', 'NO_LAN', 'PORT_IN_USE', 'FILE_ACCESS', 'MISSING_FILE', 'DATABASE_ERROR',
  'CPU_INSTRUCTION', 'NATIVE_DEPENDENCY', 'WRONG_ARCHITECTURE', 'SERVICE_TIMEOUT', 'WEBVIEW_MISSING',
  'STARTUP_ERROR', 'SERVICE_EXIT', 'FILE_BUSY', 'DISK_FULL', 'PATH_TOO_LONG', 'FILE_VALIDATION', 'SCAN_ERROR'
])
const receiptPattern = /^NS1\.([1-9][0-9]{0,11})\.([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/
const replyPrefix = '回复用户：'
const marker = nonce => 'NikkiSync diagnostic v1 ' + nonce + '\n'
const boundedInt = (value, min, max) => Number.isInteger(value) && value >= min && value <= max

class HttpFault extends Error {
  constructor(status) { super(); this.status = status }
}

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
}

function parseReport(value) {
  if (!exactKeys(value, ['schema', 'platform', 'version', 'build', 'osBuild', 'errors'])
      || value.schema !== 1 || !['android', 'windows'].includes(value.platform)
      || typeof value.version !== 'string' || !/^[0-9]{1,4}(\.[0-9]{1,4}){2,3}$/.test(value.version)
      || !boundedInt(value.build, 1, 9999999999) || !boundedInt(value.osBuild, 1, 999999)
      || !Array.isArray(value.errors) || value.errors.length > 24) throw new HttpFault(400)
  const allowed = value.platform === 'android' ? androidCodes : windowsCodes
  const seen = new Set()
  const errors = value.errors.map(event => {
    if (!exactKeys(event, ['code', 'count']) || !allowed.has(event.code) || seen.has(event.code)
        || !boundedInt(event.count, 1, 9999)) throw new HttpFault(400)
    seen.add(event.code)
    return {code: event.code, count: event.count}
  })
  return {schema: 1, platform: value.platform, version: value.version, build: value.build, osBuild: value.osBuild, errors}
}

async function readReport(request) {
  if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json') throw new HttpFault(415)
  if (Number(request.headers['content-length']) > 4096) throw new HttpFault(413)
  let size = 0
  const chunks = []
  for await (const chunk of request.iterator({destroyOnReturn: false})) {
    size += chunk.length
    if (size > 4096) throw new HttpFault(413)
    chunks.push(chunk)
  }
  let value
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')) }
  catch { throw new HttpFault(400) }
  return parseReport(value)
}

function windowLimit(max, period) {
  let expires = 0, remaining = 0
  return () => {
    if (Date.now() >= expires) { expires = Date.now() + period; remaining = max }
    if (remaining <= 0) throw new HttpFault(429)
    remaining -= 1
  }
}

export function createSupportGateway({repo, token, receiptSecret, replyUser, fetchCnb = fetch}) {
  if (!/^[\w.-]+(?:\/[\w.-]+)+$/.test(repo ?? '') || repo.split('/').some(part => part === '.' || part === '..')
      || !token || !Buffer.isBuffer(receiptSecret) || receiptSecret.length !== 32
      || !/^[\w.-]{1,80}$/.test(replyUser ?? '')) throw new Error('Missing or invalid support gateway configuration')

  const cnbOrigin = 'https://api.cnb.cool/' + repo.split('/').map(encodeURIComponent).join('/')
  const signature = (issue, nonce) => createHmac('sha256', receiptSecret)
    .update('NikkiSync feedback v1\n' + repo + '\n' + issue + '\n' + nonce).digest('base64url')
  const limitSubmissions = windowLimit(30, 600_000)
  const limitReads = windowLimit(300, 600_000)

  async function cnb(path, method = 'GET', body) {
    const response = await fetchCnb(new URL(cnbOrigin + path), {
      method, redirect: 'error', signal: AbortSignal.timeout(10000),
      headers: {Accept: 'application/json', Authorization: 'Bearer ' + token, 'Content-Type': 'application/json'},
      ...(body ? {body: JSON.stringify(body)} : {})
    })
    if (response.status === 404 && /^\/-\/issues\/[0-9]+$/.test(path)) throw new HttpFault(404)
    if (!response.ok) throw new HttpFault(503)
    return response.json()
  }

  async function requirePrivateRepo() {
    const repository = await cnb('')
    if (repository.visibility_level !== 'Private') throw new HttpFault(503)
  }

  async function submit(request) {
    const report = await readReport(request)
    limitSubmissions()
    await requirePrivateRepo()
    const nonce = randomBytes(16).toString('base64url')
    const created = await cnb('/-/issues', 'POST', {
      title: (report.platform === 'android' ? '[Android]' : '[Windows]') + ' 诊断 ' + report.version + ' (' + report.build + ')',
      body: marker(nonce) + '\n```json\n' + JSON.stringify(report, null, 2) + '\n```',
      invisible: true
    })
    const issue = String(created.number)
    if (!/^[1-9][0-9]{0,11}$/.test(issue) || created.invisible !== true) throw new HttpFault(503)
    return {issue, receipt: ['NS1', issue, nonce, signature(issue, nonce)].join('.')}
  }

  async function readReplies(request) {
    const match = receiptPattern.exec(request.headers.authorization?.replace(/^Bearer /, '') ?? '')
    if (!request.headers.authorization?.startsWith('Bearer ') || !match) throw new HttpFault(404)
    const [, issue, nonce, mac] = match
    if (!timingSafeEqual(Buffer.from(mac), Buffer.from(signature(issue, nonce)))) throw new HttpFault(404)
    limitReads()
    await requirePrivateRepo()
    const path = '/-/issues/' + issue
    const entry = await cnb(path)
    if (entry.invisible !== true || typeof entry.body !== 'string' || !entry.body.startsWith(marker(nonce))) throw new HttpFault(404)
    const comments = await cnb(path + '/comments?page=1&page_size=50&sort=-updated')
    if (!Array.isArray(comments)) throw new HttpFault(503)
    const replies = comments
      .filter(comment => comment?.author?.username === replyUser && typeof comment.body === 'string' && comment.body.startsWith(replyPrefix))
      .map(comment => {
        const time = Date.parse(comment.updated_at ?? comment.created_at ?? '')
        return {message: comment.body.slice(replyPrefix.length).trim().slice(0, 1200),
          at: Number.isFinite(time) ? new Date(time).toISOString().replace('.000Z', 'Z') : ''}
      })
      .filter(reply => reply.message.length > 0).slice(0, 12)
    return {issue, closed: entry.state === 'closed', replies}
  }

  return createServer({requestTimeout: 15000, headersTimeout: 10000}, async (request, response) => {
    response.setHeader('Content-Type', 'application/json; charset=utf-8')
    response.setHeader('Cache-Control', 'no-store')
    try {
      if (request.method === 'POST' && request.url === '/v1/reports') {
        const receipt = await submit(request)
        response.writeHead(201).end(JSON.stringify(receipt))
      } else if (request.method === 'GET' && request.url === '/v1/replies') {
        const replies = await readReplies(request)
        response.writeHead(200).end(JSON.stringify(replies))
      } else throw new HttpFault(404)
    } catch (error) {
      request.resume()
      const status = error instanceof HttpFault ? error.status : 503
      response.writeHead(status).end(JSON.stringify({error: status}))
    }
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createSupportGateway({
    repo: process.env.MOMO_SUPPORT_CNB_REPO, token: process.env.MOMO_SUPPORT_CNB_TOKEN,
    receiptSecret: Buffer.from(process.env.MOMO_SUPPORT_RECEIPT_SECRET ?? '', 'base64url'),
    replyUser: process.env.MOMO_SUPPORT_CNB_REPLY_USER
  })
  const port = Number(process.env.MOMO_SUPPORT_PORT || 8724)
  if (!boundedInt(port, 1, 65535)) throw new Error('Invalid gateway port')
  server.listen(port, '127.0.0.1', () => console.log('NikkiSync support gateway ready on loopback'))
}
