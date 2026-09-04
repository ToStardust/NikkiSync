import { readFileSync } from 'node:fs'
import type { RemoteJsonGameVersionCalendarProviderConfig } from './RemoteJsonGameVersionCalendarProvider.js'

export interface GameVersionCalendarRemoteProviderConfig extends RemoteJsonGameVersionCalendarProviderConfig {
  intervalMs?: number
}

export interface GameVersionCalendarRemoteConfigFile {
  enabled: true
  provider: GameVersionCalendarRemoteProviderConfig
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

/**
 * Explicit opt-in for a bodyless public calendar GET.
 * Missing/disabled/non-HTTPS/invalid configuration leaves network refresh disabled.
 */
export function loadGameVersionCalendarRemoteConfigFile(filePath: string): GameVersionCalendarRemoteConfigFile | undefined {
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>
    const provider = parsed?.provider
    if (!parsed || typeof parsed !== 'object' || parsed.enabled !== true) return undefined
    if (!provider || typeof provider !== 'object' || Array.isArray(provider)) return undefined
    const record = provider as Record<string, unknown>
    if (record.type !== 'remote-json' || typeof record.id !== 'string' || record.id.trim().length === 0) return undefined
    if (typeof record.endpoint !== 'string' || !/^https:\/\//i.test(record.endpoint)) return undefined
    for (const key of ['intervalMs', 'timeoutMs'] as const) {
      if (record[key] !== undefined && !isPositiveFiniteNumber(record[key])) return undefined
    }
    if (record.headers !== undefined && (
      !record.headers
      || typeof record.headers !== 'object'
      || Array.isArray(record.headers)
      || Object.values(record.headers).some((value) => typeof value !== 'string')
    )) return undefined
    return {
      enabled: true,
      provider: {
        id: record.id.trim(),
        endpoint: record.endpoint,
        ...(record.intervalMs === undefined ? {} : { intervalMs: record.intervalMs as number }),
        ...(record.timeoutMs === undefined ? {} : { timeoutMs: record.timeoutMs as number }),
        ...(record.headers === undefined ? {} : { headers: record.headers as Record<string, string> })
      }
    }
  } catch {
    return undefined
  }
}
