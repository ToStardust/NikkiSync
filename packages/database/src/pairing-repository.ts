import type { DatabaseManager } from './database-manager.js'
import type { PairDeviceInput } from './models.js'

export class PairingRepository {
  constructor(private readonly database: DatabaseManager) {}

  pairDevice(input: PairDeviceInput): void {
    const pairedAt = input.pairedAt ?? new Date().toISOString()
    this.database.transaction(() => {
      this.database.connection.prepare(`
        INSERT INTO paired_devices (
          device_id, device_name, platform, public_key, credential_hash, app_version, paired_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(device_id) DO UPDATE SET
          device_name = excluded.device_name,
          platform = excluded.platform,
          public_key = excluded.public_key,
          credential_hash = excluded.credential_hash,
          app_version = excluded.app_version,
          revoked_at = NULL
      `).run(
        input.deviceId,
        input.deviceName,
        input.platform,
        input.publicKey,
        input.credentialHash,
        input.appVersion ?? null,
        pairedAt
      )
      this.database.connection.prepare(`
        INSERT INTO device_sync_state (device_id, last_ack_revision, updated_at)
        VALUES (?, 0, ?)
        ON CONFLICT(device_id) DO NOTHING
      `).run(input.deviceId, pairedAt)
    })
  }

  getDevice(deviceId: string): Record<string, unknown> | undefined {
    return this.database.connection.prepare(
      'SELECT * FROM paired_devices WHERE device_id = ?'
    ).get(deviceId) as Record<string, unknown> | undefined
  }

  countActiveDevices(): number {
    const row = this.database.connection.prepare(
      'SELECT COUNT(*) AS count FROM paired_devices WHERE revoked_at IS NULL'
    ).get() as { count: number | bigint }
    return Number(row.count)
  }

  createSession(tokenHash: string, serverId: string, expiresAt: string, createdAt = new Date().toISOString()): void {
    this.database.connection.prepare(`
      INSERT INTO pairing_sessions (pairing_token_hash, server_id, expires_at, used_at, created_at)
      VALUES (?, ?, ?, NULL, ?)
    `).run(tokenHash, serverId, expiresAt, createdAt)
  }

  consumeSession(tokenHash: string, now = new Date().toISOString()): 'ok' | 'missing' | 'expired' | 'used' {
    return this.database.transaction(() => {
      const row = this.database.connection.prepare(
        'SELECT * FROM pairing_sessions WHERE pairing_token_hash = ?'
      ).get(tokenHash) as Record<string, unknown> | undefined
      if (!row) return 'missing'
      if (row.used_at) return 'used'
      if (String(row.expires_at) <= now) return 'expired'
      this.database.connection.prepare(
        'UPDATE pairing_sessions SET used_at = ? WHERE pairing_token_hash = ? AND used_at IS NULL'
      ).run(now, tokenHash)
      return 'ok'
    })
  }

  touchDevice(deviceId: string, lastSeenAt = new Date().toISOString()): void {
    this.database.connection.prepare(
      'UPDATE paired_devices SET last_seen_at = ? WHERE device_id = ? AND revoked_at IS NULL'
    ).run(lastSeenAt, deviceId)
  }

  acknowledgeRevision(deviceId: string, revision: number): void {
    this.database.connection.prepare(
      'UPDATE device_sync_state SET last_ack_revision = ?, updated_at = ? WHERE device_id = ?'
    ).run(revision, new Date().toISOString(), deviceId)
  }

  revoke(deviceId: string, revokedAt = new Date().toISOString()): void {
    this.database.connection.prepare(
      'UPDATE paired_devices SET revoked_at = ? WHERE device_id = ?'
    ).run(revokedAt, deviceId)
  }
}
