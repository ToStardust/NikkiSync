import os from 'node:os'
import path from 'node:path'
import { PcCompanionRuntime } from './runtime.js'

function firstIpv4(): string | undefined {
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) return entry.address
    }
  }
  return undefined
}

const databaseSetting = process.env.NIKKISYNC_DB ?? 'nikkisync.sqlite'
const databaseFile = databaseSetting === ':memory:' ? ':memory:' : path.resolve(databaseSetting)
const host = process.env.NIKKISYNC_BIND ?? '0.0.0.0'
const port = Number(process.env.NIKKISYNC_PORT ?? 0)
const mdns = process.env.NIKKISYNC_MDNS !== '0'
const runtime = new PcCompanionRuntime({ databaseFile, server: { host, port, mdns } })

async function main(): Promise<void> {
  const started = await runtime.start()
  const pairingHost = process.env.NIKKISYNC_HOST ?? firstIpv4()
  if (!pairingHost) throw new Error('No LAN IPv4 address was found; set NIKKISYNC_HOST explicitly')
  const pairingUri = runtime.createPairingUri(pairingHost)
  console.log('NikkiSync PC Companion M2 dev server')
  console.log(`database: ${databaseFile}`)
  console.log(`scan: ${started.scan.assetsCreated} created, ${started.scan.assetsUpdated} updated, ${started.scan.assetsDeleted} deleted`)
  console.log(`server: https://${pairingHost}:${started.server.port}`)
  console.log('\nPair once on Android by pasting this URI:')
  console.log(pairingUri)
  console.log('\nThe pairing token expires in 5 minutes and becomes invalid after first use.')
}

async function shutdown(): Promise<void> {
  try { await runtime.stop() } finally { process.exit(0) }
}

process.once('SIGINT', () => { void shutdown() })
process.once('SIGTERM', () => { void shutdown() })
main().catch(async (error) => {
  console.error(error)
  try { await runtime.stop() } catch { /* best effort */ }
  process.exit(1)
})
