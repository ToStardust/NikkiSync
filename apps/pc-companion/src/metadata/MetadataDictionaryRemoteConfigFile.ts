import { readFileSync } from 'node:fs'
import type { MetadataDictionaryProvider } from './MetadataDictionaryProvider.js'
import { NikkiAlbumsMetadataDictionaryProvider } from './NikkiAlbumsMetadataDictionaryProvider.js'
import { RemoteJsonMetadataDictionaryProvider } from './RemoteJsonMetadataDictionaryProvider.js'
import type { RemoteJsonMetadataDictionaryProviderConfig } from './RemoteJsonMetadataDictionaryProvider.js'

type RemoteJsonProviderConfig = RemoteJsonMetadataDictionaryProviderConfig & {
  type: 'remote-json'
  intervalMs?: number
}

type NikkiAlbumsProviderConfig = {
  type: 'nikki-albums-public'
  id?: string
  manifestEndpoint?: string
  locale?: string
  intervalMs?: number
  timeoutMs?: number
  headers?: Record<string, string>
}

export type MetadataDictionaryRemoteProviderConfig = RemoteJsonProviderConfig | NikkiAlbumsProviderConfig

export interface MetadataDictionaryRemoteConfigFile {
  enabled?: boolean
  provider?: MetadataDictionaryRemoteProviderConfig
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function validHeaders(value: unknown): value is Record<string, string> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.values(value).every((entry) => typeof entry === 'string')
}

/**
 * Optional, explicit opt-in for bodyless remote dictionary GETs.
 * Invalid, missing, or non-HTTPS configuration leaves remote updates disabled.
 */
export function loadMetadataDictionaryRemoteConfigFile(filePath: string): MetadataDictionaryRemoteConfigFile | undefined {
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>
    const provider = parsed?.provider
    if (!parsed || typeof parsed !== 'object' || !provider || typeof provider !== 'object' || Array.isArray(provider)) return undefined
    const record = provider as Record<string, unknown>
    if (parsed.enabled !== undefined && typeof parsed.enabled !== 'boolean') return undefined
    for (const key of ['intervalMs', 'timeoutMs'] as const) {
      if (record[key] !== undefined && !isPositiveFiniteNumber(record[key])) return undefined
    }
    if (record.headers !== undefined && !validHeaders(record.headers)) return undefined
    if (record.locale !== undefined && typeof record.locale !== 'string') return undefined

    if (record.type === 'remote-json') {
      if (typeof record.id !== 'string' || !record.id) return undefined
      if (typeof record.endpoint !== 'string' || !/^https:\/\//i.test(record.endpoint)) return undefined
      return {
        ...(parsed.enabled === undefined ? {} : { enabled: parsed.enabled }),
        provider: {
          type: 'remote-json',
          id: record.id,
          endpoint: record.endpoint,
          ...(record.locale === undefined ? {} : { locale: record.locale as string }),
          ...(record.intervalMs === undefined ? {} : { intervalMs: record.intervalMs as number }),
          ...(record.timeoutMs === undefined ? {} : { timeoutMs: record.timeoutMs as number }),
          ...(record.headers === undefined ? {} : { headers: record.headers as Record<string, string> })
        }
      }
    }

    if (record.type === 'nikki-albums-public') {
      if (record.id !== undefined && (typeof record.id !== 'string' || !record.id)) return undefined
      if (record.manifestEndpoint !== undefined
        && (typeof record.manifestEndpoint !== 'string' || !/^https:\/\//i.test(record.manifestEndpoint))) return undefined
      return {
        ...(parsed.enabled === undefined ? {} : { enabled: parsed.enabled }),
        provider: {
          type: 'nikki-albums-public',
          ...(record.id === undefined ? {} : { id: record.id as string }),
          ...(record.manifestEndpoint === undefined ? {} : { manifestEndpoint: record.manifestEndpoint as string }),
          ...(record.locale === undefined ? {} : { locale: record.locale as string }),
          ...(record.intervalMs === undefined ? {} : { intervalMs: record.intervalMs as number }),
          ...(record.timeoutMs === undefined ? {} : { timeoutMs: record.timeoutMs as number }),
          ...(record.headers === undefined ? {} : { headers: record.headers as Record<string, string> })
        }
      }
    }
    return undefined
  } catch {
    return undefined
  }
}

export function createMetadataDictionaryProviderFromConfig(
  config: MetadataDictionaryRemoteConfigFile | undefined
): MetadataDictionaryProvider | undefined {
  if (config?.enabled !== true || !config.provider) return undefined
  if (config.provider.type === 'remote-json') {
    return new RemoteJsonMetadataDictionaryProvider({
      id: config.provider.id,
      endpoint: config.provider.endpoint,
      ...(config.provider.locale ? { locale: config.provider.locale } : {}),
      ...(config.provider.timeoutMs === undefined ? {} : { timeoutMs: config.provider.timeoutMs }),
      ...(config.provider.headers ? { headers: config.provider.headers } : {})
    })
  }
  return new NikkiAlbumsMetadataDictionaryProvider({
    ...(config.provider.id ? { id: config.provider.id } : {}),
    ...(config.provider.manifestEndpoint ? { manifestEndpoint: config.provider.manifestEndpoint } : {}),
    ...(config.provider.locale ? { locale: config.provider.locale } : {}),
    ...(config.provider.timeoutMs === undefined ? {} : { timeoutMs: config.provider.timeoutMs }),
    ...(config.provider.headers ? { headers: config.provider.headers } : {})
  })
}
