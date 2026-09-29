import type { DatabaseManager } from '@nikkisync/database'
import { RemoteFileProvider, type LocalRemotePhotoResource, type RemotePhotoResource } from './RemoteFileProvider.js'
import { RemoteSessionStore, type CreatedRemoteSession, type RemoteAccessFailure } from './RemoteSessionStore.js'

type RemoteListResult = { status: 'ok'; resources: RemotePhotoResource[] } | { status: RemoteAccessFailure }
type RemoteResourceResult = { status: 'ok' } & LocalRemotePhotoResource | { status: RemoteAccessFailure }

export class RemoteBridgeService {
  private readonly files: RemoteFileProvider
  private readonly sessions: RemoteSessionStore

  constructor(database: DatabaseManager, options: { now?: () => number } = {}) {
    this.files = new RemoteFileProvider(database)
    this.sessions = new RemoteSessionStore(options.now)
  }

  createSession(selectedResourceIds: readonly string[]): CreatedRemoteSession {
    const ids = [...new Set(selectedResourceIds)]
    if (ids.length === 0 || ids.length > 100) throw new Error('Select 1 to 100 photos before creating a remote session')
    for (const id of ids) {
      if (!this.files.getPhoto(id)) throw new Error(`Selected resource is not an available photo: ${id}`)
    }
    return this.sessions.create(ids)
  }

  listResources(sessionId: string, token: string): RemoteListResult {
    const access = this.sessions.authorize(sessionId, token)
    if (access.status !== 'ok') return access
    const resources = access.resourceIds.flatMap((id) => {
      const resource = this.files.getPhoto(id)
      if (!resource) return []
      const { sourcePath: _sourcePath, ...publicResource } = resource
      return [publicResource]
    })
    return { status: 'ok', resources }
  }

  getResource(sessionId: string, token: string, resourceId: string): RemoteResourceResult {
    const access = this.sessions.authorize(sessionId, token)
    if (access.status !== 'ok') return access
    if (!access.resourceIds.includes(resourceId)) return { status: 'not_found' }
    const resource = this.files.getPhoto(resourceId)
    return resource ? { status: 'ok', ...resource } : { status: 'not_found' }
  }

  closeSession(sessionId: string): void { this.sessions.close(sessionId) }
  closeAllSessions(): void { this.sessions.closeAll() }
}

