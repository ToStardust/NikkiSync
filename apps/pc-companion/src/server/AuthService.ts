import { createHash, createPublicKey, verify } from 'node:crypto'
import { PairingRepository, type DatabaseManager } from '@nikkisync/database'
import type { IncomingMessage } from 'node:http'

function bodyHash(body: Uint8Array): string {
  return createHash('sha256').update(body).digest('hex')
}

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name.toLowerCase()]
  return Array.isArray(value) ? value[0] : value
}

function parsePublicKey(value: string) {
  if (value.includes('BEGIN PUBLIC KEY')) return createPublicKey(value)
  return createPublicKey({ key: Buffer.from(value, 'base64url'), format: 'der', type: 'spki' })
}

export class AuthService {
  private readonly pairing: PairingRepository
  private readonly nonces = new Map<string, number>()

  constructor(database: DatabaseManager, private readonly clockSkewMs = 5 * 60_000) {
    this.pairing = new PairingRepository(database)
  }

  verifyRequest(req: IncomingMessage, body: Uint8Array = Buffer.alloc(0)): string | undefined {
    const deviceId = header(req, 'x-nikkisync-device-id')
    const timestamp = header(req, 'x-nikkisync-timestamp')
    const nonce = header(req, 'x-nikkisync-nonce')
    const signature = header(req, 'x-nikkisync-signature')
    if (!deviceId || !timestamp || !nonce || !signature) return undefined
    const ts = Number(timestamp)
    const now = Date.now()
    if (!Number.isFinite(ts) || Math.abs(now - ts) > this.clockSkewMs) return undefined
    this.pruneNonces(now)
    const nonceKey = `${deviceId}:${nonce}`
    if (this.nonces.has(nonceKey)) return undefined
    const device = this.pairing.getDevice(deviceId)
    if (!device || device.revoked_at) return undefined
    const canonical = [
      req.method ?? 'GET',
      req.url ?? '/',
      timestamp,
      nonce,
      bodyHash(body)
    ].join('\n')
    try {
      const ok = verify(
        null,
        Buffer.from(canonical, 'utf8'),
        parsePublicKey(String(device.public_key)),
        Buffer.from(signature, 'base64url')
      )
      if (!ok) return undefined
      this.nonces.set(nonceKey, now + this.clockSkewMs)
      this.pairing.touchDevice(deviceId)
      return deviceId
    } catch {
      return undefined
    }
  }

  private pruneNonces(now: number): void {
    for (const [key, expiry] of this.nonces) if (expiry <= now) this.nonces.delete(key)
  }
}
