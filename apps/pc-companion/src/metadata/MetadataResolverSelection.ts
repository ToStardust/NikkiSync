import type { MetadataResolverConfigFile } from './MetadataResolverConfigFile.js'
import { asNuan5ResolverConfig, asRemoteResolverConfig } from './MetadataResolverConfigFile.js'
import { Nuan5CompatibleResolver } from './Nuan5CompatibleResolver.js'
import { RemoteJsonMetadataResolver } from './RemoteJsonMetadataResolver.js'
import type { PhotoMetadataResolver } from './types.js'

export const DEFAULT_NUAN5_PROVIDER_VERSION = 'decode-photo2-v1'

export interface MetadataResolverEnvironmentConfig {
  endpoint?: string
  id?: string
  version?: string
}

/**
 * Select the resolver used by the packaged Windows app.
 *
 * Default behavior is online NUAN5-compatible decoding so a normal install can
 * resolve Infinity Nikki photo parameters without an extra config file.
 * A local provider config or environment endpoint still overrides the default,
 * while `enabled: false` remains an explicit emergency/debug opt-out.
 */
export function selectMetadataResolver(
  fileConfig: MetadataResolverConfigFile | undefined,
  environment: MetadataResolverEnvironmentConfig = {}
): PhotoMetadataResolver | undefined {
  if (fileConfig?.enabled === false) return undefined

  const fileNuan5 = asNuan5ResolverConfig(fileConfig?.provider)
  if (fileNuan5) {
    return new Nuan5CompatibleResolver({
      version: DEFAULT_NUAN5_PROVIDER_VERSION,
      ...fileNuan5
    })
  }

  const fileRemote = asRemoteResolverConfig(fileConfig?.provider)
  if (fileRemote) return new RemoteJsonMetadataResolver(fileRemote)

  if (environment.endpoint) {
    return new RemoteJsonMetadataResolver({
      endpoint: environment.endpoint,
      id: environment.id ?? 'remote-json',
      ...(environment.version ? { version: environment.version } : {})
    })
  }

  return new Nuan5CompatibleResolver({ version: DEFAULT_NUAN5_PROVIDER_VERSION })
}
