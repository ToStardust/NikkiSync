import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto'
import {
  AppSettingsRepository,
  PairingRepository,
  type DatabaseManager
} from '@nikkisync/database'
import type { PairRequest, PairResponse, PairingQrPayload } from '@nikkisync/protocol'
import { PROTOCOL_VERSION } from '@nikkisync/protocol'

interface ServerIdentity {
  serverId: string
  publicKeyPem: string
  privateKeyPem: string
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function makeIdentity(): ServerIdentity {
  const pair = generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  })
  return {
    serverId: `server_${randomBytes(16).toString('hex')}`,
    publicKeyPem: pair.publicKey,
    privateKeyPem: pair.privateKey
  }
}

export class PairingService {
  readonly identity: ServerIdentity
  private readonly pairing: PairingRepository
  private readonly settings: AppSettingsRepository

  constructor(database: DatabaseManager) {
    this.pairing = new PairingRepository(database)
    this.settings = new AppSettingsRepository(database)
    this.identity = this.settings.get<ServerIdentity>('server.identity') ?? makeIdentity()
    this.settings.set('server.identity', this.identity)
  }

  createQrPayload(input: {
    host: string
    port: number
    tlsFingerprintSha256: string
    ttlMs?: number
  }): PairingQrPayload {
    const token = randomBytes(24).toString('base64url')
    const expiresAt = new Date(Date.now() + (input.ttlMs ?? 5 * 60_000)).toISOString()
    this.pairing.createSession(sha256(token), this.identity.serverId, expiresAt)
    return {
      scheme: 'nikki-sync',
      action: 'pair',
      serverId: this.identity.serverId,
      host: input.host,
      port: input.port,
      pairingToken: token,
      protocolVersion: PROTOCOL_VERSION,
      expiresAt,
      tlsFingerprintSha256: input.tlsFingerprintSha256
    }
  }

  pair(request: PairRequest, serverName: string): PairResponse {
    const state = this.pairing.consumeSession(sha256(request.pairingToken))
    if (state !== 'ok') throw new PairingError(state === 'expired' ? 'pairing_expired' : 'pairing_invalid')
    const credential = randomBytes(32).toString('base64url')
    this.pairing.pairDevice({
      deviceId: request.device.deviceId,
      deviceName: request.device.deviceName,
      platform: request.device.platform,
      publicKey: request.device.publicKey,
      credentialHash: sha256(credential),
      appVersion: request.device.appVersion
    })
    return {
      serverId: this.identity.serverId,
      serverName,
      serverPublicKey: this.identity.publicKeyPem,
      deviceCredential: credential,
      protocolVersion: PROTOCOL_VERSION
    }
  }
}

export class PairingError extends Error {
  constructor(readonly code: 'pairing_expired' | 'pairing_invalid') {
    super(code)
  }
}
