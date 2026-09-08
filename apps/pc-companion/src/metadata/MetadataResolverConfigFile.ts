import { readFileSync } from 'node:fs'
import type { MetadataCapability, PhotoMetadataResolver } from './types.js'
import { MetadataResolverPipeline } from './MetadataResolverPipeline.js'
import { RemoteJsonMetadataResolver, type RemoteJsonMetadataResolverConfig } from './RemoteJsonMetadataResolver.js'
import { Nuan5CompatibleResolver, type Nuan5CompatibleResolverConfig } from './Nuan5CompatibleResolver.js'

interface ProviderPriority {
  /** Larger values run first. Equal-priority providers keep file order. */
  priority?: number
  capabilities?: MetadataCapability[]
}

export type RemoteJsonProviderConfig = ProviderPriority & {
  type: 'remote-json'
  id?: string
  version?: string
  endpoint: string
  timeoutMs?: number
  headers?: Record<string, string>
}

export type Nuan5ProviderConfig = ProviderPriority & {
  type: 'nuan5-compatible'
  id?: string
  version?: string
  endpoint?: string
  timeoutMs?: number
}

export type MetadataProviderConfig = RemoteJsonProviderConfig | Nuan5ProviderConfig

export interface MetadataResolverConfigFile {
  enabled?: boolean
  /** Legacy single-provider shape, retained for backwards compatibility. */
  provider?: MetadataProviderConfig
  /** M4.2.6 ordered multi-provider shape. */
  providers?: MetadataProviderConfig[]
}

function isProvider(value: unknown): value is MetadataProviderConfig {
  if (!value || typeof value !== 'object') return false
  const provider = value as Record<string, unknown>
  if (provider.type !== 'remote-json' && provider.type !== 'nuan5-compatible') return false
  if (provider.priority !== undefined && (typeof provider.priority !== 'number' || !Number.isFinite(provider.priority))) return false
  if (provider.capabilities !== undefined && (!Array.isArray(provider.capabilities) || provider.capabilities.some((capability) => typeof capability !== 'string'))) return false
  if (provider.type === 'remote-json') {
    return typeof provider.endpoint === 'string' && /^https:\/\//i.test(provider.endpoint)
  }
  return provider.endpoint === undefined || (typeof provider.endpoint === 'string' && /^https:\/\//i.test(provider.endpoint))
}

/** Optional hot-update config. Invalid/missing files simply leave online enrichment disabled. */
export function loadMetadataResolverConfigFile(filePath: string): MetadataResolverConfigFile | undefined {
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as MetadataResolverConfigFile
    if (!parsed || typeof parsed !== 'object') return undefined
    if (parsed.provider !== undefined && !isProvider(parsed.provider)) return undefined
    if (parsed.providers !== undefined) {
      if (!Array.isArray(parsed.providers) || parsed.providers.length === 0 || parsed.providers.some((provider) => !isProvider(provider))) return undefined
    }
    return parsed
  } catch {
    return undefined
  }
}

export function asRemoteResolverConfig(value: MetadataProviderConfig | undefined): RemoteJsonMetadataResolverConfig | undefined {
  if (!value || value.type !== 'remote-json') return undefined
  return {
    endpoint: value.endpoint,
    ...(value.id ? { id: value.id } : {}),
    ...(value.version ? { version: value.version } : {}),
    ...(value.timeoutMs ? { timeoutMs: value.timeoutMs } : {}),
    ...(value.headers ? { headers: value.headers } : {}),
    ...(value.capabilities ? { capabilities: value.capabilities } : {})
  }
}

export function asNuan5ResolverConfig(value: MetadataProviderConfig | undefined): Nuan5CompatibleResolverConfig | undefined {
  if (!value || value.type !== 'nuan5-compatible') return undefined
  return {
    ...(value.endpoint ? { endpoint: value.endpoint } : {}),
    ...(value.id ? { id: value.id } : {}),
    ...(value.version ? { version: value.version } : {}),
    ...(value.timeoutMs ? { timeoutMs: value.timeoutMs } : {})
  }
}

/** Returns provider configs in deterministic execution order. New providers[] wins over legacy provider. */
export function orderedMetadataProviderConfigs(config: MetadataResolverConfigFile | undefined): MetadataProviderConfig[] {
  const providers = config?.providers ?? (config?.provider ? [config.provider] : [])
  return providers
    .map((provider, index) => ({ provider, index }))
    .sort((left, right) => (right.provider.priority ?? 0) - (left.provider.priority ?? 0) || left.index - right.index)
    .map(({ provider }) => provider)
}

export function createMetadataResolverFromConfig(config: MetadataResolverConfigFile | undefined): PhotoMetadataResolver | undefined {
  const providers = orderedMetadataProviderConfigs(config)
  const resolvers = providers.map((provider): PhotoMetadataResolver => {
    if (provider.type === 'nuan5-compatible') return new Nuan5CompatibleResolver(asNuan5ResolverConfig(provider)!)
    return new RemoteJsonMetadataResolver(asRemoteResolverConfig(provider)!)
  })
  if (resolvers.length === 0) return undefined
  return resolvers.length === 1 ? resolvers[0] : new MetadataResolverPipeline({ resolvers })
}
