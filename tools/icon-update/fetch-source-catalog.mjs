// Refresh the public clothing-ID list using the same provider as the desktop app.
import { writeFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { NikkiAlbumsMetadataDictionaryProvider } from '../../apps/pc-companion/dist/src/metadata/NikkiAlbumsMetadataDictionaryProvider.js'

const output = process.argv[2]
if (!output) throw new Error('Usage: node fetch-source-catalog.mjs <output.json>')
const cdn = 'https://cdn.gongeo.us/images/items/icons/'
const result = await new NikkiAlbumsMetadataDictionaryProvider({ timeoutMs: 30_000 }).fetch()
if (result.status !== 'updated') throw new Error('Public clothing catalog was not refreshed')
const rows = result.manifest.entries
  .filter(entry => entry.kind === 'clothing' && /^[1-9][0-9]{9}$/.test(entry.id))
  .map(entry => ({ id: entry.id, ...(entry.name ? { name: entry.name } : {}) }))
  .sort((a, b) => a.id.localeCompare(b.id))
if (rows.length < 9000 || new Set(rows.map(row => row.id)).size !== rows.length) {
  throw new Error('Public clothing catalog is incomplete or has duplicate IDs')
}
const path = resolve(output)
await mkdir(dirname(path), { recursive: true })
await writeFile(path, JSON.stringify({ cdn, provider: result.manifest.provider,
  providerVersion: result.manifest.providerVersion, rows }), { flag: 'wx' })
console.log(JSON.stringify({ output: path, partIds: rows.length,
  providerVersion: result.manifest.providerVersion }))
