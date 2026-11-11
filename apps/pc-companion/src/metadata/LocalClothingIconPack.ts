import { createHash } from 'node:crypto'
import { lstat, open, realpath } from 'node:fs/promises'
import path from 'node:path'

const MAX_MANIFEST_BYTES = 4 * 1024 * 1024
const MAX_ICON_BYTES = 256 * 1024
const MAX_ICON_SIDE = 192
const PNG_HEADER = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')
const PNG_END = Buffer.from('0000000049454e44ae426082', 'hex')
const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex')
const validSide = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= MAX_ICON_SIDE

type IconFile = { sha256: string; file: string; webp?: { width: number; height: number; sizeBytes: number } }
type PackImage = { image: Buffer; sha256: string; mime: 'image/png' | 'image/webp'; source: 'item' | 'category' }
export type PhotoEffectKind = 'pose' | 'lighting'

export interface LocalClothingIconPack {
  readonly valid: boolean
  readonly cacheVersion: string
  sha256For(id: string): string | undefined
  read(id: string): Promise<PackImage | undefined>
  effectSha256For(kind: PhotoEffectKind, id: string): string | undefined
  readEffect(kind: PhotoEffectKind, id: string): Promise<PackImage | undefined>
}

function webpFile(entry: Record<string, unknown>, file: string): NonNullable<IconFile['webp']> {
  if (entry.file !== file || !validSide(entry.width) || !validSide(entry.height)
    || typeof entry.sizeBytes !== 'number' || !Number.isInteger(entry.sizeBytes)
    || entry.sizeBytes < 25 || entry.sizeBytes > MAX_ICON_BYTES) throw new Error('Invalid WebP icon pack entry')
  return { width: entry.width, height: entry.height, sizeBytes: entry.sizeBytes }
}

async function readPackFile(filePath: string, maxBytes: number): Promise<Buffer> {
  if (!(await lstat(filePath)).isFile()) throw new Error('Expected a regular pack file')
  const handle = await open(filePath, 'r')
  try {
    const info = await handle.stat()
    const { size } = info
    if (!info.isFile() || size < 1 || size > maxBytes) throw new Error('Invalid pack file size')
    const bytes = Buffer.alloc(size + 1)
    let offset = 0
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset)
      if (!bytesRead) break
      offset += bytesRead
    }
    if (offset !== size) throw new Error('Pack file changed during read')
    return bytes.subarray(0, size)
  } finally {
    await handle.close()
  }
}

function isPackPng(bytes: Buffer): boolean {
  if (bytes.length < 45 || !bytes.subarray(0, PNG_HEADER.length).equals(PNG_HEADER)
    || !bytes.subarray(-PNG_END.length).equals(PNG_END)) return false
  const width = bytes.readUInt32BE(16)
  const height = bytes.readUInt32BE(20)
  return width > 0 && height > 0 && width <= MAX_ICON_SIDE && height <= MAX_ICON_SIDE
}

function isPackWebp(bytes: Buffer, expected: NonNullable<IconFile['webp']>): boolean {
  if (bytes.length !== expected.sizeBytes || bytes.length < 25 || bytes.toString('ascii', 0, 4) !== 'RIFF'
    || bytes.readUInt32LE(4) !== bytes.length - 8 || bytes.toString('ascii', 8, 12) !== 'WEBP') return false
  let frame = false, extended = false
  for (let offset = 12; offset < bytes.length;) {
    if (offset + 8 > bytes.length) return false
    const chunk = bytes.toString('ascii', offset, offset + 4)
    const size = bytes.readUInt32LE(offset + 4)
    const start = offset + 8
    offset = start + size + (size % 2)
    if (offset > bytes.length || chunk === 'ANIM' || chunk === 'ANMF') return false
    if (chunk === 'VP8X') {
      if (extended || size !== 10 || (bytes[start]! & 2) !== 0
        || bytes.readUIntLE(start + 4, 3) + 1 !== expected.width
        || bytes.readUIntLE(start + 7, 3) + 1 !== expected.height) return false
      extended = true
    } else if (chunk === 'VP8 ' || chunk === 'VP8L') {
      if (frame) return false
      let width: number, height: number
      if (chunk === 'VP8 ') {
        if (size < 10 || bytes.readUIntBE(start + 3, 3) !== 0x9d012a) return false
        width = bytes.readUInt16LE(start + 6) & 0x3fff
        height = bytes.readUInt16LE(start + 8) & 0x3fff
      } else {
        if (size < 5 || bytes[start] !== 0x2f) return false
        const dimensions = bytes.readUInt32LE(start + 1)
        width = (dimensions & 0x3fff) + 1
        height = ((dimensions >>> 14) & 0x3fff) + 1
      }
      if (width !== expected.width || height !== expected.height) return false
      frame = true
    }
  }
  return frame
}

/** The installed directory selects offline icons, even if the manifest cannot be loaded. */
export async function loadLocalClothingIconPack(directory: string): Promise<LocalClothingIconPack | undefined> {
  let root: string | undefined
  let cacheVersion = sha256('unavailable-local-clothing-icons')
  const icons = new Map<string, IconFile>()
  const fallbacks = new Map<string, IconFile>()
  const effects = new Map<string, IconFile>()
  try {
    if (!(await lstat(directory)).isDirectory()) throw new Error('Expected a local pack directory')
    root = await realpath(directory)
    const manifestBytes = await readPackFile(path.join(root, 'manifest.json'), MAX_MANIFEST_BYTES)
    const manifest = JSON.parse(manifestBytes.toString('utf8'))
    const webp = manifest?.schemaVersion === 2 && manifest.imageFormat === 'webp'
    if ((!webp && manifest?.schemaVersion !== 1) || typeof manifest.version !== 'string' || !manifest.version.trim()
      || manifest.version.length > 80 || typeof manifest.source !== 'string' || !manifest.source.trim()
      || manifest.source.length > 512 || !Array.isArray(manifest.entries) || manifest.entries.length > 30_000) {
      throw new Error('Invalid icon pack manifest')
    }
    const fallbackEntries = webp ? manifest.fallbackEntries ?? [] : []
    if (!Array.isArray(fallbackEntries) || fallbackEntries.length > 30_000) throw new Error('Invalid icon pack fallbacks')
    for (const [entries, target, fallback] of [[manifest.entries, icons, false], [fallbackEntries, fallbacks, true]] as const) {
      for (const entry of entries) {
        if (typeof entry?.id !== 'string' || !/^[1-9]\d{0,11}$/.test(entry.id)
          || typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256) || target.has(entry.id)) {
          throw new Error('Invalid icon pack entry')
        }
        const file = webp ? (fallback ? `fallbacks/${entry.sha256}.webp` : `icons/${entry.id}.webp`) : entry.sha256 + '.png'
        target.set(entry.id, { sha256: entry.sha256, file, ...(webp ? { webp: webpFile(entry, file) } : {}) })
      }
    }
    const effectEntries = webp ? manifest.effectEntries ?? [] : []
    if (!Array.isArray(effectEntries) || effectEntries.length > 5000) throw new Error('Invalid photo effect entries')
    for (const entry of effectEntries) {
      if (!['pose', 'lighting'].includes(entry?.kind) || typeof entry.id !== 'string' || !/^[1-9]\d{0,11}$/.test(entry.id)
        || typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error('Invalid photo effect entry')
      const aliases = entry.aliases ?? []
      if (!Array.isArray(aliases) || aliases.length > 8
        || aliases.some(alias => typeof alias !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(alias))) {
        throw new Error('Invalid photo effect aliases')
      }
      const file = `effects/${entry.kind}-${entry.id}.webp`
      const image = { sha256: entry.sha256, file, webp: webpFile(entry, file) }
      for (const id of [entry.id, ...aliases]) {
        const key = entry.kind + ':' + id
        if (effects.has(key)) throw new Error('Duplicate photo effect entry')
        effects.set(key, image)
      }
    }
    cacheVersion = sha256(manifestBytes)
  } catch (error) {
    if (!root && (error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    root = undefined
    icons.clear()
    fallbacks.clear()
    effects.clear()
  }
  async function readIcon(entry: IconFile | undefined, source: PackImage['source']): Promise<PackImage | undefined> {
    if (!root || !entry) return undefined
    try {
      const file = path.join(root, entry.file)
      if (entry.webp && !(await lstat(path.dirname(file))).isDirectory()) return undefined
      const image = await readPackFile(file, MAX_ICON_BYTES)
      if (sha256(image) === entry.sha256 && (entry.webp ? isPackWebp(image, entry.webp) : isPackPng(image))) {
        return { image, sha256: entry.sha256, mime: entry.webp ? 'image/webp' : 'image/png', source }
      }
    } catch { /* A missing or damaged optional icon leaves the renderer's fallback. */ }
    return undefined
  }
  return {
    valid: root !== undefined,
    cacheVersion,
    sha256For(id) {
      const item = icons.get(id), fallback = fallbacks.get(id)
      return item && fallback ? sha256(item.sha256 + fallback.sha256) : item?.sha256 ?? fallback?.sha256
    },
    async read(id) {
      return await readIcon(icons.get(id), 'item') ?? readIcon(fallbacks.get(id), 'category')
    },
    effectSha256For: (kind, id) => effects.get(kind + ':' + id)?.sha256,
    readEffect: (kind, id) => readIcon(effects.get(kind + ':' + id), 'item')
  }
}
