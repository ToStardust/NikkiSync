import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { open, stat } from 'node:fs/promises'
import path from 'node:path'
import { toPathKey } from '@nikkisync/core'
import type { DiscoveredResource, DiscoveredResourceKind } from './types.js'

function normalizeStem(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '').replace(/_cover$/i, '').replace(/\s+/g, '_').toLowerCase()
}

function uidFor(filePath: string, gamePlayRoot: string): string | undefined {
  const relative = path.relative(gamePlayRoot, filePath).split(path.sep)
  return relative.find((part) => /^\d{5,}$/.test(part)) ?? filePath.split(path.sep).find((part) => /^\d{5,}$/.test(part))
}

function classifyKind(filePath: string): DiscoveredResourceKind {
  const lower = filePath.toLowerCase().replaceAll('\\', '/')
  if (lower.includes('/pendingup/') || lower.endsWith('.tmp')) return 'ignored'
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.bin') return 'binary_companion'
  if (ext === '.mp4' && /\/videos?\//i.test(lower)) return 'motion_video'
  if (/\.(jpe?g|png|webp)$/i.test(ext)) {
    if (/nik k iphotos_highquality|nikk iphotos_highquality/.test(lower.replaceAll(' ', ''))) return 'high_quality'
    if (/nikkiphotos_highquality/.test(lower)) return 'high_quality'
    if (/nikkiphotos_lowquality/.test(lower)) return 'low_quality'
    if (/\/videos?\//i.test(lower) && /_cover\.(jpe?g|png|webp)$/i.test(lower)) return 'motion_cover'
    return 'unknown_image'
  }
  return 'ignored'
}

function mimeFor(ext: string): string {
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.png') return 'image/png'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.mp4') return 'video/mp4'
  return 'application/octet-stream'
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  await new Promise<void>((resolve, reject) => {
    const input = createReadStream(filePath)
    input.on('data', (chunk) => hash.update(chunk))
    input.on('end', resolve)
    input.on('error', reject)
  })
  return hash.digest('hex')
}

async function md5Prefix(filePath: string, endExclusive: number): Promise<string> {
  const hash = createHash('md5')
  await new Promise<void>((resolve, reject) => {
    const input = createReadStream(filePath, { start: 0, end: endExclusive - 1 })
    input.on('data', (chunk) => hash.update(chunk))
    input.on('end', resolve)
    input.on('error', reject)
  })
  return hash.digest('hex')
}

async function nativePhotoEnvelope(filePath: string, size: number, ext: string): Promise<{ token?: string; payload?: string; nuan5Md5?: string }> {
  if ((ext !== '.jpg' && ext !== '.jpeg') || size < 46) return {}
  const handle = await open(filePath, 'r')
  try {
    // Current Infinity Nikki photos place a printable parameter blob before the delimiter EOI
    // immediately preceding the final token. Since game 2.9 appends a versioned suffix after
    // the token, locate the final EOI inside a bounded tail window instead of assuming it is
    // exactly 46 bytes from EOF.
    const windowSize = Math.min(size, 2 * 1024 * 1024)
    const windowStart = size - windowSize
    const window = Buffer.alloc(windowSize)
    const result = await handle.read(window, 0, window.length, windowStart)
    if (result.bytesRead !== window.length) return {}
    const finalEoi = window.lastIndexOf(Buffer.from([0xff, 0xd9]))
    if (finalEoi < 0) return {}
    const trailer = window.subarray(finalEoi + 2)
    if (trailer.length < 44) return {}
    const token = trailer.subarray(0, 44).toString('ascii')
    if (!/^[A-Za-z0-9+/]{43}=$/.test(token) || Buffer.from(token, 'base64').length !== 32) return {}
    const suffix = trailer.subarray(44).toString('ascii')
    if (suffix !== '' && !/^\[V2\]\d{7}$/.test(suffix)) return {}

    const previousEoi = window.lastIndexOf(Buffer.from([0xff, 0xd9]), finalEoi - 1)
    if (previousEoi < 0) return { token }
    const payloadBytes = window.subarray(previousEoi + 2, finalEoi)
    if (payloadBytes.length === 0 || payloadBytes.length > 2 * 1024 * 1024) return { token }
    const payload = payloadBytes.toString('ascii')
    const printable = /^[\x20-\x7e]+$/.test(payload)
    if (!printable) return { token }
    // NUAN5's current decode-photo2 contract hashes every source byte before the final EOI.
    // The bytes remain local; only this 32-character digest is retained for the resolver.
    return { token, payload, nuan5Md5: await md5Prefix(filePath, windowStart + finalEoi) }
  } finally { await handle.close() }
}

export class ResourceClassifier {
  classifyPath(filePath: string): DiscoveredResourceKind { return classifyKind(filePath) }

  async classify(filePath: string, gamePlayRoot: string): Promise<DiscoveredResource> {
    const info = await stat(filePath)
    const fileExt = path.extname(filePath).toLowerCase()
    const kind = classifyKind(filePath)
    const fileName = path.basename(filePath)
    const shouldHash = !['ignored', 'unknown_image', 'binary_companion'].includes(kind)
    const digest = shouldHash ? await sha256File(filePath) : undefined
    const nativeEnvelope = (kind === 'high_quality' || kind === 'motion_cover')
      ? await nativePhotoEnvelope(filePath, info.size, fileExt)
      : {}
    const uid = uidFor(filePath, gamePlayRoot)
    return {
      absolutePath: path.resolve(filePath), pathKey: toPathKey(filePath), ...(uid ? { uid } : {}), kind,
      fileName, normalizedStem: normalizeStem(fileName), sizeBytes: info.size, mtimeMs: info.mtimeMs,
      ...(info.birthtimeMs ? { birthtimeMs: info.birthtimeMs } : {}), ...(digest ? { sha256: digest } : {}),
      ...(nativeEnvelope.token ? { nativeParamToken: nativeEnvelope.token } : {}),
      ...(nativeEnvelope.payload ? { nativeParamPayload: nativeEnvelope.payload } : {}),
      ...(nativeEnvelope.nuan5Md5 ? { nativeParamNuan5Md5: nativeEnvelope.nuan5Md5 } : {}),
      mimeType: mimeFor(fileExt), fileExt
    }
  }
}
