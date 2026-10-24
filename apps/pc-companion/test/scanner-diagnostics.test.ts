import assert from 'node:assert/strict'
import test from 'node:test'
import {scanDiagnosticSummary} from '../src/scanner/ScanDiagnostics.js'

test('zero scan distinguishes missing scan roots from an existing empty folder without exporting paths',()=>{
  const scanner={getStatus:()=>({status:'running' as const}),getScanRoots:()=>[] as string[],getAutomaticRoots:()=>[] as string[],getExtraDirectoryCount:()=>0}
  assert.deepEqual(scanDiagnosticSummary(scanner).scanRootCount,0)
  const value=scanDiagnosticSummary({...scanner,getScanRoots:()=>['C:\\private-user\\photos'],getAutomaticRoots:()=>['C:\\private-user\\photos']})
  assert.equal(value.scanRootCount,1);assert.equal(value.automaticRootCount,1)
  assert.equal(value.lastScan,undefined);assert.doesNotMatch(JSON.stringify(value),/private-user|photos/)
})
test('completed scans include acceptance and error counts while omitting all raw file names and errors',()=>{
  const value=scanDiagnosticSummary({getStatus:()=>({status:'running',lastScan:{scanId:'private-id',roots:['private-path'],filesObserved:3,resourcesAccepted:1,resourcesIgnored:2,assetsCreated:1,assetsUpdated:0,assetsDeleted:0,journalRevisions:[],pendingPaths:['private-token'],errors:['private-error']}}),getScanRoots:()=>['private-path'],getAutomaticRoots:()=>[],getExtraDirectoryCount:()=>1})
  assert.equal(value.extraRootCount,1);assert.deepEqual(value.lastScan,{filesObserved:3,resourcesAccepted:1,resourcesIgnored:2,assetsCreated:1,assetsUpdated:0,assetsDeleted:0,errorCount:1})
  assert.doesNotMatch(JSON.stringify(value),/private-|roots|pendingPaths|errors/)
})
