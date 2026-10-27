// Do not write error.stack/message: Bun can include source, photo paths and secrets.
import { ScanIndexFailure } from '../scanner/ScanIndexFailure.js'

function databaseFailure(error: unknown, description: string) {
  const categories: Record<number, string> = {1:'sql',5:'busy',6:'locked',7:'memory',8:'read-only',10:'io',11:'corrupt',13:'full',14:'cannot-open',17:'schema',18:'too-big',19:'constraint',20:'type-mismatch',26:'not-database'}
  const symbols: Record<string,number> = {ERROR:1,BUSY:5,LOCKED:6,NOMEM:7,READONLY:8,IOERR:10,CORRUPT:11,FULL:13,CANTOPEN:14,SCHEMA:17,TOOBIG:18,CONSTRAINT:19,MISMATCH:20,NOTADB:26}
  const fields=error && typeof error==='object' ? error as Record<string,unknown> : {}
  const extended=[fields.errcode,fields.errno].find((value):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>0&&value<=65535&&Boolean(categories[value&255]))
  const symbolic=Object.entries(symbols).find(([name])=>new RegExp(`\\bSQLITE_${name}(?:_[A-Z]+)*\\b`,'i').test(description))?.[1]
  const result=extended===undefined?symbolic:extended&255
  const category=result===undefined?'unknown':categories[result]??'unknown'
  const constraint=category!=='constraint'?undefined
    : /UNIQUE constraint failed:\s*resources\.path_key\b/i.test(description)?'resource-path-unique'
    : /UNIQUE constraint failed:\s*resources\.resource_id\b/i.test(description)?'resource-id-unique'
    : /UNIQUE constraint failed:\s*assets\.asset_id\b/i.test(description)?'asset-id-unique'
    : /FOREIGN KEY constraint failed/i.test(description)?'foreign-key'
    : /CHECK constraint failed/i.test(description)?'check'
    : /NOT NULL constraint failed/i.test(description)?'not-null':'unknown'
  return {category,...(result===undefined?{}:{resultCode:result}),...(extended===undefined?{}:{extendedCode:extended}),...(constraint?{constraint}:{})}
}

export function startupFailureRecord(error: unknown, phase: 'configuration' | 'database-and-tls' | 'scanner-and-lan' | 'desktop-control') {
  const source=error instanceof ScanIndexFailure ? error.cause : error
  const message = source instanceof Error ? source.message : ''
  const nativeCode = typeof source === 'object' && source !== null && 'code' in source ? String(source.code) : ''
  const description = message + ' ' + nativeCode
  const code = description.includes('Infinity Nikki installation was not found') ? 'GAME_NOT_FOUND'
    : description.includes('未找到局域网 IPv4 地址') ? 'NO_LAN'
    : description.includes('EADDRINUSE') ? 'PORT_IN_USE'
    : /EACCES|EPERM|无法找到可写的数据目录/.test(description) ? 'FILE_ACCESS'
    : description.includes('ENOENT') ? 'MISSING_FILE'
    : /SQLITE_|database (?:is locked|disk image is malformed)|not a database/i.test(description) ? 'DATABASE_ERROR'
    : 'SERVICE_EXIT'
  const count=(value:number)=>Number.isSafeInteger(value)&&value>=0&&value<1e12?value:0
  return { kind: 'nikkisync-startup', phase, code, runtime: process.versions.bun ?? process.versions.node,
    ...(code==='DATABASE_ERROR'?{database:databaseFailure(source,description)}:{}),
    ...(error instanceof ScanIndexFailure?{index:{operation:error.operation,processedAssets:count(error.processedAssets),observedResources:count(error.observedResources)}}:{}) }
}
