import { readFileSync } from 'node:fs'
import type { RemoteJsonMetadataDictionaryProviderConfig } from './RemoteJsonMetadataDictionaryProvider.js'

export interface MetadataDictionaryRemoteProviderConfig extends RemoteJsonMetadataDictionaryProviderConfig {
  intervalMs?: number
}

export interface MetadataDictionaryRemoteConfigFile {
  enabled?: boolean
  provider?: MetadataDictionaryRemoteProviderConfig
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

/**
 * Optional, explicit opt-in for a bodyless remote dictionary GET.
 * Invalid, missing, or non-HTTPS configuration leaves remote updates disabled.
 */
export function loadMetadataDictionaryRemoteConfigFile(filePath: string): MetadataDictionaryRemoteConfigFile | undefined {
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>
    const provider = parsed?.provider
    if (!parsed || typeof parsed !== 'object' || !provider || typeof provider !== 'object' || Array.isArray(provider)) return undefined
    const record = provider as Record<string, unknown>
    if (parsed.enabled !== undefined && typeof parsed.enabled !== 'boolean') return undefined
    if (record.type !== 'remote-json' || typeof record.id !== 'string' || !record.id) return undefined
    if (typeof record.endpoint !== 'string' || !/^https:\/\//i.test(record.endpoint)) return undefined
    for (const key of ['locale'] as const) if (record[key] !== undefined && typeof record[key] !== 'string') return undefined
    for (const key of ['intervalMs', 'timeoutMs'] as const) if (record[key] !== undefined && !isPositiveFiniteNumber(record[key])) return undefined
    if (record.headers !== undefined && (!record.headers || typeof record.headers !== 'object' || Array.isArray(record.headers) || Object.values(record.headers).some((value) => typeof value !== 'string'))) return undefined
    return {
      ...(parsed.enabled === undefined ? {} : { enabled: parsed.enabled }),
      provider: {
        id: record.id,
        endpoint: record.endpoint,
        ...(record.locale === undefined ? {} : { locale: record.locale as string }),
        ...(record.intervalMs === undefined ? {} : { intervalMs: record.intervalMs as number }),
        ...(record.timeoutMs === undefined ? {} : { timeoutMs: record.timeoutMs as number }),
        ...(record.headers === undefined ? {} : { headers: record.headers as Record<string, string> })
      }
    }
  } catch {
    return undefined
  }
}
