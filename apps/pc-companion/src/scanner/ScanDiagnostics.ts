import type {ScannerService} from './ScannerService.js'

/** Counts only: never serialize paths, UIDs, file names, raw errors or parameters. */
export function scanDiagnosticSummary(scanner:Pick<ScannerService,'getStatus'|'getScanRoots'|'getAutomaticRoots'|'getExtraDirectoryCount'>){
  const status=scanner.getStatus(),last=status.lastScan
  const count=(value:number)=>Number.isSafeInteger(value)&&value>=0?value:0
  return {timestamp:new Date().toISOString(),status:status.status,installationFound:!!status.installation,
    scanRootCount:scanner.getScanRoots().length,automaticRootCount:scanner.getAutomaticRoots().length,extraRootCount:scanner.getExtraDirectoryCount(),
    ...(last?{lastScan:{filesObserved:count(last.filesObserved),resourcesAccepted:count(last.resourcesAccepted),resourcesIgnored:count(last.resourcesIgnored),
      assetsCreated:count(last.assetsCreated),assetsUpdated:count(last.assetsUpdated),assetsDeleted:count(last.assetsDeleted),errorCount:last.errors.length}}:{})}
}
