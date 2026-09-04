import { readFileSync } from 'node:fs'
import type { RemoteJsonMetadataResolverConfig } from './RemoteJsonMetadataResolver.js'
import type { Nuan5CompatibleResolverConfig } from './Nuan5CompatibleResolver.js'

type RemoteJsonProviderConfig = {
  type: 'remote-json'
  id?: string
  version?: string
  endpoint: string
  timeoutMs?: number
  headers?: Record<string, string>
}

type Nuan5ProviderConfig = {
  type: 'nuan5-compatible'
  id?: string
  version?: string
  endpoint?: string
  timeoutMs?: number
}

export interface MetadataResolverConfigFile {
  enabled?: boolean
  provider?: RemoteJsonProviderConfig | Nuan5ProviderConfig
}

/** Optional hot-update config. Invalid/missing files simply leave online enrichment disabled. */
export function loadMetadataResolverConfigFile(filePath: string): MetadataResolverConfigFile | undefined {
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as MetadataResolverConfigFile
    if (!parsed || typeof parsed !== 'object') return undefined
    if (parsed.provider && parsed.provider.type !== 'remote-json' && parsed.provider.type !== 'nuan5-compatible') return undefined
    if (parsed.provider?.type === 'remote-json' && (typeof parsed.provider.endpoint !== 'string' || !/^https:\/\//i.test(parsed.provider.endpoint))) return undefined
    if (parsed.provider?.type === 'nuan5-compatible' && parsed.provider.endpoint !== undefined && (typeof parsed.provider.endpoint !== 'string' || !/^https:\/\//i.test(parsed.provider.endpoint))) return undefined
    return parsed
  } catch {
    return undefined
  }
}

export function asRemoteResolverConfig(value: MetadataResolverConfigFile['provider']): RemoteJsonMetadataResolverConfig | undefined {
  if (!value || value.type !== 'remote-json') return undefined
  return {
    endpoint: value.endpoint,
    ...(value.id ? { id: value.id } : {}),
    ...(value.version ? { version: value.version } : {}),
    ...(value.timeoutMs ? { timeoutMs: value.timeoutMs } : {}),
    ...(value.headers ? { headers: value.headers } : {})
  }
}

export function asNuan5ResolverConfig(value: MetadataResolverConfigFile['provider']): Nuan5CompatibleResolverConfig | undefined {
  if (!value || value.type !== 'nuan5-compatible') return undefined
  return {
    ...(value.endpoint ? { endpoint: value.endpoint } : {}),
    ...(value.id ? { id: value.id } : {}),
    ...(value.version ? { version: value.version } : {}),
    ...(value.timeoutMs ? { timeoutMs: value.timeoutMs } : {})
  }
}
