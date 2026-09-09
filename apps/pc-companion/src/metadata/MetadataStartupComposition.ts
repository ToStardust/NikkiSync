import type { MetadataDictionaryProvider } from './MetadataDictionaryProvider.js'
import {
  createMetadataDictionaryProviderFromConfig,
  type MetadataDictionaryRemoteConfigFile
} from './MetadataDictionaryRemoteConfigFile.js'
import { NikkiAlbumsMetadataDictionaryProvider } from './NikkiAlbumsMetadataDictionaryProvider.js'
import {
  createMetadataResolverFromConfig,
  type MetadataResolverConfigFile
} from './MetadataResolverConfigFile.js'
import { Nuan5CompatibleResolver } from './Nuan5CompatibleResolver.js'
import { RemoteJsonMetadataResolver, type RemoteJsonMetadataResolverConfig } from './RemoteJsonMetadataResolver.js'
import type { PhotoMetadataResolver } from './types.js'

/** Compose the online resolver used by the desktop startup path. */
export function composeMetadataResolver(
  config: MetadataResolverConfigFile | undefined,
  environment: RemoteJsonMetadataResolverConfig | undefined
): PhotoMetadataResolver | undefined {
  if (config?.enabled === false) return undefined
  const configured = createMetadataResolverFromConfig(config)
  if (configured) return configured
  if (environment) return new RemoteJsonMetadataResolver(environment)
  return new Nuan5CompatibleResolver()
}

/** Compose the public clothing dictionary used by a clean install. */
export function composeMetadataDictionaryProvider(
  config: MetadataDictionaryRemoteConfigFile | undefined
): MetadataDictionaryProvider | undefined {
  if (config?.enabled === false) return undefined
  if (config?.enabled === true) return createMetadataDictionaryProviderFromConfig(config)
  return new NikkiAlbumsMetadataDictionaryProvider({ locale: 'zh-CN' })
}
