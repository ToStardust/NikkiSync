// Do not write error.stack/message: Bun can include source, photo paths and secrets.
export function startupFailureRecord(error: unknown, phase: 'configuration' | 'database-and-tls' | 'scanner-and-lan' | 'desktop-control') {
  const message = error instanceof Error ? error.message : ''
  const nativeCode = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : ''
  const description = message + ' ' + nativeCode
  const code = description.includes('Infinity Nikki installation was not found') ? 'GAME_NOT_FOUND'
    : description.includes('未找到局域网 IPv4 地址') ? 'NO_LAN'
    : description.includes('EADDRINUSE') ? 'PORT_IN_USE'
    : /EACCES|EPERM|无法找到可写的数据目录/.test(description) ? 'FILE_ACCESS'
    : description.includes('ENOENT') ? 'MISSING_FILE'
    : /SQLITE_|database (?:is locked|disk image is malformed)|not a database/i.test(description) ? 'DATABASE_ERROR'
    : 'SERVICE_EXIT'
  return { kind: 'nikkisync-startup', phase, code, runtime: process.versions.bun ?? process.versions.node }
}
