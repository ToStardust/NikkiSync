/** Keep the cause in memory; only fixed operations and counts may enter diagnostics. */
export class ScanIndexFailure extends Error {
  constructor(cause: unknown, readonly operation: 'build-snapshots' | 'write-asset' | 'mark-missing',
    readonly processedAssets: number, readonly observedResources: number) {
    super('Photo index operation failed.', { cause })
    this.name = 'ScanIndexFailure'
  }
}
