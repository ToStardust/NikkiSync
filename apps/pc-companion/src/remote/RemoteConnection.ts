import { isIPv4 } from 'node:net'

export interface RemoteConnection {
  endpoint: string
  tlsFingerprintSha256: string
}

export function validateRemoteConnection(connection: RemoteConnection): RemoteConnection {
  const url = new URL(connection.endpoint)
  const octets = url.hostname.split('.').map(Number)
  const privateAddress = isIPv4(url.hostname) && (octets[0] === 10
    || (octets[0] === 192 && octets[1] === 168)
    || (octets[0] === 172 && octets[1]! >= 16 && octets[1]! <= 31))
  if (url.protocol !== 'https:' || !privateAddress || url.username || url.password
    || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Remote Bridge requires a local private IPv4 HTTPS endpoint')
  }
  if (!/^[a-fA-F0-9]{64}$/.test(connection.tlsFingerprintSha256)) throw new Error('Invalid TLS fingerprint')
  return { endpoint: url.origin, tlsFingerprintSha256: connection.tlsFingerprintSha256.toLowerCase() }
}
