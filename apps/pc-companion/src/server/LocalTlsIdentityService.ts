import { createSign, generateKeyPairSync, randomBytes, X509Certificate } from 'node:crypto'
import { AppSettingsRepository, type DatabaseManager } from '@nikkisync/database'

export interface LocalTlsIdentity {
  keyPem: string
  certPem: string
  fingerprintSha256: string
  createdAt: string
}

function lengthBytes(length: number): Buffer {
  if (length < 0x80) return Buffer.from([length])
  const bytes: number[] = []
  let value = length
  while (value > 0) { bytes.unshift(value & 0xff); value >>>= 8 }
  return Buffer.from([0x80 | bytes.length, ...bytes])
}

function der(tag: number, content: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), lengthBytes(content.length), content])
}

function seq(...items: Buffer[]): Buffer { return der(0x30, Buffer.concat(items)) }
function set(...items: Buffer[]): Buffer { return der(0x31, Buffer.concat(items)) }
function nullValue(): Buffer { return der(0x05, Buffer.alloc(0)) }
function utf8(value: string): Buffer { return der(0x0c, Buffer.from(value, 'utf8')) }
function octet(value: Buffer): Buffer { return der(0x04, value) }
function bitString(value: Buffer): Buffer { return der(0x03, Buffer.concat([Buffer.from([0]), value])) }
function explicit(tag: number, value: Buffer): Buffer { return der(0xa0 + tag, value) }

function integer(value: Buffer | number): Buffer {
  let data = typeof value === 'number'
    ? (() => {
        const out: number[] = []; let n = value
        do { out.unshift(n & 0xff); n >>>= 8 } while (n > 0)
        return Buffer.from(out)
      })()
    : Buffer.from(value)
  while (data.length > 1 && data[0] === 0) data = data.subarray(1)
  if ((data[0] ?? 0) & 0x80) data = Buffer.concat([Buffer.from([0]), data])
  return der(0x02, data)
}

function oid(value: string): Buffer {
  const parts = value.split('.').map(Number)
  const body: number[] = [parts[0]! * 40 + parts[1]!]
  for (const part of parts.slice(2)) {
    const encoded = [part & 0x7f]
    let n = Math.floor(part / 128)
    while (n > 0) { encoded.unshift(0x80 | (n & 0x7f)); n = Math.floor(n / 128) }
    body.push(...encoded)
  }
  return der(0x06, Buffer.from(body))
}

function utcTime(date: Date): Buffer {
  const yy = String(date.getUTCFullYear() % 100).padStart(2, '0')
  const value = `${yy}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}${String(date.getUTCHours()).padStart(2, '0')}${String(date.getUTCMinutes()).padStart(2, '0')}${String(date.getUTCSeconds()).padStart(2, '0')}Z`
  return der(0x17, Buffer.from(value, 'ascii'))
}

function pem(label: string, data: Buffer): string {
  const base64 = data.toString('base64').match(/.{1,64}/g)?.join('\n') ?? ''
  return `-----BEGIN ${label}-----\n${base64}\n-----END ${label}-----\n`
}

function algorithm(): Buffer { return seq(oid('1.2.840.113549.1.1.11'), nullValue()) }

function name(commonName: string): Buffer {
  return seq(set(seq(oid('2.5.4.3'), utf8(commonName))))
}

function extension(id: string, value: Buffer): Buffer { return seq(oid(id), octet(value)) }

function createCertificate(keyPem: string, publicSpki: Buffer): string {
  const now = new Date(Date.now() - 24 * 60 * 60_000)
  const later = new Date(Date.now() + 10 * 365 * 24 * 60 * 60_000)
  const subject = name('NikkiSync Local')
  const extensions = seq(
    extension('2.5.29.19', seq()),
    extension('2.5.29.17', seq(der(0x82, Buffer.from('nikkisync.local', 'ascii'))))
  )
  const tbs = seq(
    explicit(0, integer(2)),
    integer(randomBytes(16)),
    algorithm(),
    subject,
    seq(utcTime(now), utcTime(later)),
    subject,
    publicSpki,
    explicit(3, extensions)
  )
  const signer = createSign('RSA-SHA256')
  signer.update(tbs); signer.end()
  const cert = seq(tbs, algorithm(), bitString(signer.sign(keyPem)))
  return pem('CERTIFICATE', cert)
}

function generateIdentity(): LocalTlsIdentity {
  const keys = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  })
  const certPem = createCertificate(keys.privateKey, keys.publicKey)
  return {
    keyPem: keys.privateKey,
    certPem,
    fingerprintSha256: new X509Certificate(certPem).fingerprint256.replaceAll(':', '').toLowerCase(),
    createdAt: new Date().toISOString()
  }
}

/** Local-only TLS identity. Private material stays on the PC; mobile trusts it only after QR fingerprint pinning. */
export class LocalTlsIdentityService {
  private readonly settings: AppSettingsRepository
  constructor(database: DatabaseManager) { this.settings = new AppSettingsRepository(database) }

  getOrCreate(): LocalTlsIdentity {
    const existing = this.settings.get<LocalTlsIdentity>('server.tlsIdentity')
    if (existing) {
      const parsed = new X509Certificate(existing.certPem)
      const fingerprint = parsed.fingerprint256.replaceAll(':', '').toLowerCase()
      if (fingerprint === existing.fingerprintSha256) return existing
    }
    const identity = generateIdentity()
    this.settings.set('server.tlsIdentity', identity)
    return identity
  }
}
