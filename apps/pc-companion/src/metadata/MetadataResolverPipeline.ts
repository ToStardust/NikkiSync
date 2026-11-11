import type { InfinityPhotoMetadata } from '@nikkisync/core'
import type { DatabaseManager } from '@nikkisync/database'
import { MetadataResolutionFailure } from './types.js'
import type {
  MetadataCapability,
  MetadataResolutionOutcome,
  PhotoMetadataResolveRequest,
  PhotoMetadataResolveResult,
  PhotoMetadataResolver
} from './types.js'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Merge provider metadata by priority: values from earlier providers win, while later
 * providers may fill missing nested fields. Arrays and scalar values are treated as
 * atomic values so a fallback provider cannot silently replace a higher-priority result.
 */
function mergeMissing<T>(target: T, source: T): T {
  if (!isPlainObject(target) || !isPlainObject(source)) return target
  const output: Record<string, unknown> = { ...target }
  for (const [key, sourceValue] of Object.entries(source)) {
    const targetValue = output[key]
    if (targetValue === undefined || targetValue === null) {
      output[key] = sourceValue
      continue
    }
    if (isPlainObject(targetValue) && isPlainObject(sourceValue)) {
      output[key] = mergeMissing(targetValue, sourceValue)
    }
  }
  return output as T
}

export interface MetadataResolverPipelineConfig {
  id?: string
  /** Ordered highest-priority first. */
  resolvers: PhotoMetadataResolver[]
}

export class MetadataResolverPipeline implements PhotoMetadataResolver {
  readonly id: string
  readonly version: string
  readonly capabilities: MetadataCapability[]

  private readonly resolvers: PhotoMetadataResolver[]

  constructor(config: MetadataResolverPipelineConfig) {
    if (config.resolvers.length === 0) throw new Error('metadata resolver pipeline requires at least one provider')
    this.resolvers = [...config.resolvers]
    this.id = config.id ?? `pipeline:${this.resolvers.map((resolver) => resolver.id).join(',')}`
    this.version = this.resolvers
      .map((resolver) => `${resolver.id}@${resolver.version ?? 'unversioned'}`)
      .join('|')
    this.capabilities = [...new Set(this.resolvers.flatMap((resolver) => resolver.capabilities ?? []))]
  }

  async resolve(request: PhotoMetadataResolveRequest, database?: DatabaseManager): Promise<PhotoMetadataResolveResult> {
    const outcomes: MetadataResolutionOutcome[] = []
    for (const resolver of this.resolvers) {
      try { outcomes.push({ status: 'fulfilled', value: await resolver.resolve(request, database) }) }
      catch (reason) { outcomes.push({ status: 'rejected', reason }) }
    }
    return this.merge(outcomes)
  }

  get batchSize(): number {
    return Math.max(...this.resolvers.map(resolver => resolver.batchSize ?? 12))
  }

  async resolveBatch(requests: readonly PhotoMetadataResolveRequest[], database: DatabaseManager): Promise<MetadataResolutionOutcome[]> {
    const all: MetadataResolutionOutcome[][] = requests.map(() => [])
    for (const resolver of this.resolvers) {
      if (resolver.resolveBatch) {
        const results = await resolver.resolveBatch(requests, database)
        results.forEach((outcome, index) => { all[index]!.push(outcome) })
        continue
      }
      for (const [index, request] of requests.entries()) {
        try {
          request.signal?.throwIfAborted()
          if (request.isCurrent?.() === false) throw new Error('Photo changed')
          all[index]!.push({ status: 'fulfilled', value: await resolver.resolve(request, database) })
        } catch (reason) { all[index]!.push({ status: 'rejected', reason }) }
      }
    }
    return all.map(outcomes => {
      try { return { status: 'fulfilled', value: this.merge(outcomes) } }
      catch (reason) { return { status: 'rejected', reason } }
    })
  }

  private merge(outcomes: MetadataResolutionOutcome[]): PhotoMetadataResolveResult {
    let metadata: Partial<InfinityPhotoMetadata> = {}
    const successes: Array<{ provider: string, providerVersion?: string, capabilities?: MetadataCapability[] }> = []
    const failures: Array<{ provider: string, error: string }> = []
    const rawResponses: Array<{ provider: string, response: unknown }> = []

    for (const [index, outcome] of outcomes.entries()) {
      const resolver = this.resolvers[index]!
      if (outcome.status === 'fulfilled') {
        const result = outcome.value
        metadata = mergeMissing(metadata, result.metadata)
        successes.push({
          provider: result.provider,
          ...(result.providerVersion ? { providerVersion: result.providerVersion } : {}),
          ...(result.capabilities ?? resolver.capabilities
            ? { capabilities: result.capabilities ?? resolver.capabilities }
            : {})
        })
        if (result.rawResponse !== undefined) rawResponses.push({ provider: result.provider, response: result.rawResponse })
      } else {
        const error: unknown = outcome.reason
        failures.push({
          provider: resolver.id,
          error: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500)
        })
      }
    }

    if (successes.length === 0) {
      const classified = outcomes.flatMap(outcome =>
        outcome.status === 'rejected' && outcome.reason instanceof MetadataResolutionFailure ? [outcome.reason] : [])
      if (classified.length === outcomes.length && classified.length) {
        const next = classified.reduce((earliest, item) => Math.min(earliest, item.nextAttemptAt ?? Infinity), Infinity)
        throw new MetadataResolutionFailure(classified[0]!.category, next === Infinity ? null : next)
      }
      throw new AggregateError(
        failures.map((failure) => new Error(`${failure.provider}: ${failure.error}`)),
        'all metadata resolver providers failed'
      )
    }

    const capabilities = [...new Set(successes.flatMap((success) => success.capabilities ?? []))]
    return {
      metadata,
      provider: this.id,
      providerVersion: this.version,
      ...(capabilities.length > 0 ? { capabilities } : {}),
      rawResponse: {
        providers: successes,
        ...(failures.length > 0 ? { failures } : {}),
        ...(rawResponses.length > 0 ? { responses: rawResponses } : {})
      }
    }
  }
}
