import { DefaultOnlineMetadataDictionaryProvider } from './DefaultOnlineMetadataDictionaryProvider.js'
import type { MetadataDictionaryProvider } from './MetadataDictionaryProvider.js'
import type { MetadataDictionaryUpdateServiceConfig } from './MetadataDictionaryUpdateService.js'
import type { MetadataDictionaryRemoteConfigFile } from './MetadataDictionaryRemoteConfigFile.js'
import { RemoteJsonMetadataDictionaryProvider } from './RemoteJsonMetadataDictionaryProvider.js'

export interface MetadataDictionaryRemoteSelection {
  provider: MetadataDictionaryProvider
  service: MetadataDictionaryUpdateServiceConfig
}

/**
 * Select the metadata dictionary updater used by the packaged Windows app.
 *
 * Static public camera/clothing dictionaries are enabled by default. A valid
 * explicitly enabled remote-json config overrides that source, while
 * `enabled: false` remains an explicit opt-out.
 */
export function selectMetadataDictionaryRemote(
  fileConfig: MetadataDictionaryRemoteConfigFile | undefined
): MetadataDictionaryRemoteSelection | undefined {
  if (fileConfig?.enabled === false) return undefined

  if (fileConfig?.enabled === true && fileConfig.provider) {
    return {
      provider: new RemoteJsonMetadataDictionaryProvider(fileConfig.provider),
      service: {
        enabled: true,
        ...(fileConfig.provider.intervalMs === undefined
          ? {}
          : { intervalMs: fileConfig.provider.intervalMs })
      }
    }
  }

  return {
    provider: new DefaultOnlineMetadataDictionaryProvider(),
    service: { enabled: true }
  }
}
