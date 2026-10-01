import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { RemoteConnection } from './RemoteConnection.js'

export type RemoteSessionState = 'created' | 'connected' | 'expired' | 'closed'
export type RemoteAccessFailure = 'not_found' | 'invalid_token' | 'expired' | 'closed'

interface StoredSession {
  sessionId: string
  tokenDigest: Buffer
  resourceIds: readonly string[]
  hashes: ReadonlyMap<string, string>
  expiresAtMs: number
  state: RemoteSessionState
}

export interface CreatedRemoteSession {
  sessionId: string
  token: string
  expiresAt: string
  qrPayload: string
  state: 'created'
}

export interface RemoteSessionStatus {
  sessionId: string
  expiresAt: string
  state: RemoteSessionState
  selectedCount: number
}

export class RemoteSessionStore {
  private readonly sessions = new Map<string, StoredSession>()

  constructor(private readonly now: () => number = Date.now) {}

  create(selections: readonly { resourceId: string; sha256: string }[], connection: RemoteConnection): CreatedRemoteSession {
    for (const [id, session] of this.sessions) {
      if (this.now() >= session.expiresAtMs + 600_000) this.sessions.delete(id)
    }
    const sessionId = randomBytes(16).toString('base64url')
    const token = randomBytes(32).toString('base64url')
    const expiresAtMs = this.now() + 600_000
    const expiresAt = new Date(expiresAtMs).toISOString()
    this.sessions.set(sessionId, {
      sessionId,
      tokenDigest: createHash('sha256').update(token).digest(),
      resourceIds: selections.map((item) => item.resourceId),
      hashes: new Map(selections.map((item) => [item.resourceId, item.sha256])),
      expiresAtMs,
      state: 'created'
    })
    return {
      sessionId, token, expiresAt, state: 'created',
      qrPayload: JSON.stringify({ type: 'NikkiSyncRemoteBridge', version: 1, sessionId, token, expiresAt, ...connection })
    }
  }

  authorize(sessionId: string, token: string): { status: 'ok'; resourceIds: readonly string[]; hashes: ReadonlyMap<string, string> } | { status: RemoteAccessFailure } {
    const session = this.sessions.get(sessionId)
    if (!session) return { status: 'not_found' }
    if (session.state === 'closed') return { status: 'closed' }
    if (session.state === 'expired' || this.now() >= session.expiresAtMs) {
      session.state = 'expired'
      return { status: 'expired' }
    }
    const candidate = createHash('sha256').update(token).digest()
    if (!timingSafeEqual(candidate, session.tokenDigest)) return { status: 'invalid_token' }
    session.state = 'connected'
    return { status: 'ok', resourceIds: session.resourceIds, hashes: session.hashes }
  }

  close(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (session) session.state = 'closed'
  }

  closeAll(): void {
    for (const session of this.sessions.values()) session.state = 'closed'
  }

  status(sessionId: string): RemoteSessionStatus | undefined {
    const session = this.sessions.get(sessionId)
    if (!session) return undefined
    if (session.state !== 'closed' && this.now() >= session.expiresAtMs) session.state = 'expired'
    return { sessionId, expiresAt: new Date(session.expiresAtMs).toISOString(), state: session.state, selectedCount: session.resourceIds.length }
  }
}

