import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

export type RemoteSessionState = 'created' | 'connected' | 'expired' | 'closed'
export type RemoteAccessFailure = 'not_found' | 'invalid_token' | 'expired' | 'closed'

interface StoredSession {
  sessionId: string
  tokenDigest: Buffer
  resourceIds: readonly string[]
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

export class RemoteSessionStore {
  private readonly sessions = new Map<string, StoredSession>()

  constructor(private readonly now: () => number = Date.now) {}

  create(resourceIds: readonly string[]): CreatedRemoteSession {
    const sessionId = randomBytes(16).toString('base64url')
    const token = randomBytes(32).toString('base64url')
    const expiresAtMs = this.now() + 600_000
    const expiresAt = new Date(expiresAtMs).toISOString()
    this.sessions.set(sessionId, {
      sessionId,
      tokenDigest: createHash('sha256').update(token).digest(),
      resourceIds: [...resourceIds],
      expiresAtMs,
      state: 'created'
    })
    return {
      sessionId, token, expiresAt, state: 'created',
      qrPayload: JSON.stringify({ type: 'NikkiSyncRemoteBridge', version: 1, sessionId, token, expiresAt })
    }
  }

  authorize(sessionId: string, token: string): { status: 'ok'; resourceIds: readonly string[] } | { status: RemoteAccessFailure } {
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
    return { status: 'ok', resourceIds: session.resourceIds }
  }

  close(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (session) session.state = 'closed'
  }

  closeAll(): void {
    for (const session of this.sessions.values()) session.state = 'closed'
  }
}

