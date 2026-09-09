import { createDecipheriv, hkdfSync } from 'node:crypto'
import type { MetadataDictionaryEntry, MetadataDictionaryManifest } from '@nikkisync/core'
import type {
  MetadataDictionaryFetchResult,
  MetadataDictionaryFetchState,
  MetadataDictionaryProvider
} from './MetadataDictionaryProvider.js'

const DEFAULT_MANIFEST_ENDPOINT = 'https://nikki.ranaxro.com/app_api/hot_update.json'
const PACKAGE_KEY = Buffer.from('9C46C6BF431F5AFFF97A2002AEDFA8B7', 'ascii')
const PACKAGE_INFO = Buffer.from('aes-gcm-filebox', 'ascii')
const SALT_LENGTH = 16
const NONCE_LENGTH = 12
const TAG_LENGTH = 16

const CLOTH_TYPE_NAMES = new Map<number, string>([
  [10, 'hair'], [90, 'dresses'], [20, 'outerwear'], [30, 'tops'], [41, 'bottoms'],
  [50, 'socks'], [60, 'shoes'], [71, 'hairAccessories'], [72, 'headwear'], [73, 'earrings'],
  [74, 'neckwear'], [75, 'bracelets'], [76, 'chokers'], [77, 'gloves'], [92, 'faceDecorations'],
  [93, 'chestAccessories'], [94, 'pendants'], [95, 'backpieces'], [96, 'rings'], [97, 'armDecorations'],
  [78, 'handhelds'], [79, 'bodyPaint'], [80, 'fullMakeup'], [81, 'baseMakeup'], [82, 'eyebrows'],
  [83, 'eyelashes'], [84, 'contacts'], [85, 'lips'], [86, 'skinTones']
])

type HotUpdateFile = { path: string, downloadLink: string }
type HotUpdateGroup = { id: string, versionId: string, files: HotUpdateFile[] }
type NetworkImageTemplate = { baseUrl: string, replace: string }

interface ParsedNuan5Database {
  clothTypes: Map<number, number>
  clothImage?: NetworkImageTemplate
  clothTypeImage?: NetworkImageTemplate
}

export interface NikkiAlbumsMetadataDictionaryProviderConfig {
  id?: string
  manifestEndpoint?: string
  locale?: string
  timeoutMs?: number
  headers?: Record<string, string>
}

/**
 * Optional adapter for the public Nikki Albums hot-update feed.
 *
 * It performs bodyless GETs only. Photo UID/token/payload/media bytes are never sent.
 * The package container and protobuf layout are implemented from the MIT-licensed
 * RanAxro/nikki_albums interoperability code; source data remains owned by its providers.
 */
export class NikkiAlbumsMetadataDictionaryProvider implements MetadataDictionaryProvider {
  readonly id: string
  private readonly endpoint: string
  private readonly locale: string

  constructor(private readonly config: NikkiAlbumsMetadataDictionaryProviderConfig = {}) {
    this.id = config.id ?? 'nikki-albums-public'
    this.endpoint = config.manifestEndpoint ?? DEFAULT_MANIFEST_ENDPOINT
    this.locale = config.locale ?? 'zh-CN'
  }

  async fetch(state?: MetadataDictionaryFetchState): Promise<MetadataDictionaryFetchResult> {
    const response = await this.fetchWithTimeout(this.endpoint, {
      accept: 'application/json',
      'accept-language': this.locale,
      ...(state?.etag ? { 'if-none-match': state.etag } : {}),
      ...(state?.lastModified ? { 'if-modified-since': state.lastModified } : {}),
      ...(this.config.headers ?? {})
    })
    const etag = response.headers.get('etag') ?? undefined
    const lastModified = response.headers.get('last-modified') ?? undefined
    if (response.status === 304) {
      return {
        status: 'not-modified',
        ...(etag ? { etag } : {}),
        ...(lastModified ? { lastModified } : {})
      }
    }
    if (!response.ok) throw new Error(`Nikki Albums manifest HTTP ${response.status}`)

    const groups = this.parseManifest(await response.json())
    const langGroup = groups.find((group) => group.id === 'infinity_nikki')
    const databaseGroup = groups.find((group) => group.id === 'nuan5_database')
    if (!langGroup || !databaseGroup) throw new Error('Nikki Albums hot-update manifest is missing required groups')

    const languageFile = langGroup.files.find((file) => file.path === `${this.locale}.bin`)
    const databaseFile = databaseGroup.files.find((file) => file.path === 'v1.db')
    if (!languageFile || !databaseFile) throw new Error(`Nikki Albums hot-update does not provide locale ${this.locale}`)

    const [languagePackage, databasePackage] = await Promise.all([
      this.fetchBytes(languageFile.downloadLink),
      this.fetchBytes(databaseFile.downloadLink)
    ])
    const language = decodeMessagePack(decryptNikkiAlbumsPackage(languagePackage))
    const database = parseNuan5Database(decryptNikkiAlbumsPackage(databasePackage))
    const manifest = buildDictionaryManifest({
      provider: this.id,
      providerVersion: `${langGroup.versionId}:${databaseGroup.versionId}`,
      language,
      database
    })
    return {
      status: 'updated',
      manifest,
      ...(etag ? { etag } : {}),
      ...(lastModified ? { lastModified } : {})
    }
  }

  private async fetchBytes(url: string): Promise<Buffer> {
    if (!/^https:\/\//i.test(url)) throw new Error('Nikki Albums hot-update file URL must use HTTPS')
    const response = await this.fetchWithTimeout(url, {
      accept: 'application/octet-stream',
      ...(this.config.headers ?? {})
    })
    if (!response.ok) throw new Error(`Nikki Albums hot-update file HTTP ${response.status}`)
    return Buffer.from(await response.arrayBuffer())
  }

  private async fetchWithTimeout(url: string, headers: Record<string, string>): Promise<Response> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 15_000)
    try {
      return await fetch(url, { method: 'GET', headers, signal: controller.signal })
    } finally {
      clearTimeout(timer)
    }
  }

  private parseManifest(value: unknown): HotUpdateGroup[] {
    if (!Array.isArray(value)) throw new Error('Nikki Albums hot-update manifest must be an array')
    return value.map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('invalid hot-update group')
      const record = item as Record<string, unknown>
      if (typeof record.id !== 'string' || typeof record.versionId !== 'string' || !Array.isArray(record.files)) {
        throw new Error('invalid hot-update group fields')
      }
      const files = record.files.map((file) => {
        if (!file || typeof file !== 'object' || Array.isArray(file)) throw new Error('invalid hot-update file')
        const entry = file as Record<string, unknown>
        if (typeof entry.path !== 'string' || typeof entry.downloadLink !== 'string' || !/^https:\/\//i.test(entry.downloadLink)) {
          throw new Error('invalid hot-update file fields')
        }
        return { path: entry.path, downloadLink: entry.downloadLink }
      })
      return { id: record.id, versionId: record.versionId, files }
    })
  }
}

export function decryptNikkiAlbumsPackage(input: Buffer): Buffer {
  if (input.length < SALT_LENGTH + NONCE_LENGTH + TAG_LENGTH) throw new Error('Nikki Albums package is too small')
  const salt = input.subarray(0, SALT_LENGTH)
  const nonce = input.subarray(SALT_LENGTH, SALT_LENGTH + NONCE_LENGTH)
  const encryptedWithTag = input.subarray(SALT_LENGTH + NONCE_LENGTH)
  const ciphertext = encryptedWithTag.subarray(0, encryptedWithTag.length - TAG_LENGTH)
  const tag = encryptedWithTag.subarray(encryptedWithTag.length - TAG_LENGTH)
  const key = Buffer.from(hkdfSync('sha256', PACKAGE_KEY, salt, PACKAGE_INFO, 32))
  const decipher = createDecipheriv('aes-256-gcm', key, nonce)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()])
}

function renderTemplate(template: NetworkImageTemplate | undefined, value: string | number): string | undefined {
  if (!template?.replace) return undefined
  const rendered = template.baseUrl.split(template.replace).join(String(value))
  return /^https:\/\//i.test(rendered) ? rendered : undefined
}

export function buildDictionaryManifest(input: {
  provider: string
  providerVersion: string
  language: unknown
  database: ParsedNuan5Database
}): MetadataDictionaryManifest {
  const names = getNestedStringMap(input.language, ['infinity_nikki', 'cloth'])
  const entries: MetadataDictionaryEntry[] = []
  for (const [id, clothType] of [...input.database.clothTypes.entries()].sort((a, b) => a[0] - b[0])) {
    const name = names.get(String(id))
    const category = CLOTH_TYPE_NAMES.get(clothType)
    const thumbnail = renderTemplate(input.database.clothImage, id)
    const typeThumbnail = renderTemplate(input.database.clothTypeImage, clothType)
    const thumbnailFallbacks = typeThumbnail && typeThumbnail !== thumbnail ? [typeThumbnail] : undefined
    entries.push({
      kind: 'clothing',
      id: String(id),
      ...(name ? { name } : {}),
      ...(category ? { category } : {}),
      ...(thumbnail ? { thumbnail } : {}),
      ...(thumbnailFallbacks ? { thumbnailFallbacks } : {}),
      raw: { clothType, source: 'nikki-albums-public' }
    })
  }
  if (entries.length === 0) throw new Error('Nikki Albums database returned no clothing entries')
  return {
    schemaVersion: 1,
    provider: input.provider,
    providerVersion: input.providerVersion,
    entries
  }
}

function getNestedStringMap(value: unknown, path: string[]): Map<string, string> {
  let current = value
  for (const key of path) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return new Map()
    current = (current as Record<string, unknown>)[key]
  }
  if (!current || typeof current !== 'object' || Array.isArray(current)) return new Map()
  return new Map(Object.entries(current as Record<string, unknown>)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
}

function parseNetworkImageTemplate(buffer: Buffer): NetworkImageTemplate | undefined {
  let baseUrl = ''
  let replace = ''
  for (const imageField of readProtobufFields(buffer)) {
    if (imageField.number === 1 && Buffer.isBuffer(imageField.value)) baseUrl = imageField.value.toString('utf8')
    if (imageField.number === 2 && Buffer.isBuffer(imageField.value)) replace = imageField.value.toString('utf8')
  }
  return baseUrl ? { baseUrl, replace } : undefined
}

function parseNuan5Database(buffer: Buffer): ParsedNuan5Database {
  const clothTypes = new Map<number, number>()
  let clothImage: ParsedNuan5Database['clothImage']
  let clothTypeImage: ParsedNuan5Database['clothTypeImage']
  for (const field of readProtobufFields(buffer)) {
    if (field.number === 11 && field.wireType === 2 && Buffer.isBuffer(field.value)) {
      let id: number | undefined
      let clothType: number | undefined
      for (const entryField of readProtobufFields(field.value)) {
        if (entryField.number === 1 && entryField.wireType === 0 && typeof entryField.value === 'bigint') {
          id = Number(entryField.value)
        } else if (entryField.number === 2 && entryField.wireType === 2 && Buffer.isBuffer(entryField.value)) {
          const typeField = readProtobufFields(entryField.value)
            .find((candidate) => candidate.number === 1 && candidate.wireType === 0 && typeof candidate.value === 'bigint')
          if (typeField && typeof typeField.value === 'bigint') clothType = Number(typeField.value)
        }
      }
      if (id !== undefined && clothType !== undefined) clothTypes.set(id, clothType)
    } else if (field.number === 20001 && field.wireType === 2 && Buffer.isBuffer(field.value)) {
      for (const imageField of readProtobufFields(field.value)) {
        if (imageField.wireType !== 2 || !Buffer.isBuffer(imageField.value)) continue
        if (imageField.number === 4) clothImage = parseNetworkImageTemplate(imageField.value)
        if (imageField.number === 7) clothTypeImage = parseNetworkImageTemplate(imageField.value)
      }
    }
  }
  return {
    clothTypes,
    ...(clothImage ? { clothImage } : {}),
    ...(clothTypeImage ? { clothTypeImage } : {})
  }
}

type ProtoField = { number: number, wireType: number, value: bigint | Buffer }

function readProtobufFields(buffer: Buffer): ProtoField[] {
  const fields: ProtoField[] = []
  let offset = 0
  while (offset < buffer.length) {
    const key = readVarint(buffer, offset)
    offset = key.offset
    const number = Number(key.value >> 3n)
    const wireType = Number(key.value & 7n)
    if (wireType === 0) {
      const value = readVarint(buffer, offset)
      offset = value.offset
      fields.push({ number, wireType, value: value.value })
    } else if (wireType === 1) {
      if (offset + 8 > buffer.length) throw new Error('truncated protobuf fixed64')
      fields.push({ number, wireType, value: buffer.subarray(offset, offset + 8) })
      offset += 8
    } else if (wireType === 2) {
      const length = readVarint(buffer, offset)
      offset = length.offset
      const size = Number(length.value)
      if (!Number.isSafeInteger(size) || size < 0 || offset + size > buffer.length) throw new Error('invalid protobuf length')
      fields.push({ number, wireType, value: buffer.subarray(offset, offset + size) })
      offset += size
    } else if (wireType === 5) {
      if (offset + 4 > buffer.length) throw new Error('truncated protobuf fixed32')
      fields.push({ number, wireType, value: buffer.subarray(offset, offset + 4) })
      offset += 4
    } else {
      throw new Error(`unsupported protobuf wire type ${wireType}`)
    }
  }
  return fields
}

function readVarint(buffer: Buffer, start: number): { value: bigint, offset: number } {
  let value = 0n
  let shift = 0n
  let offset = start
  while (offset < buffer.length && shift <= 63n) {
    const byte = buffer[offset]!
    offset++
    value |= BigInt(byte & 0x7f) << shift
    if ((byte & 0x80) === 0) return { value, offset }
    shift += 7n
  }
  throw new Error('invalid protobuf varint')
}

export function decodeMessagePack(buffer: Buffer): unknown {
  let offset = 0
  const read = (): unknown => {
    if (offset >= buffer.length) throw new Error('truncated MessagePack payload')
    const prefix = buffer[offset++]!
    if (prefix <= 0x7f) return prefix
    if (prefix >= 0xe0) return prefix - 0x100
    if ((prefix & 0xf0) === 0x80) return readMap(prefix & 0x0f)
    if ((prefix & 0xf0) === 0x90) return readArray(prefix & 0x0f)
    if ((prefix & 0xe0) === 0xa0) return readString(prefix & 0x1f)
    switch (prefix) {
      case 0xc0: return null
      case 0xc2: return false
      case 0xc3: return true
      case 0xc4: return readBinary(readUInt(1))
      case 0xc5: return readBinary(readUInt(2))
      case 0xc6: return readBinary(readUInt(4))
      case 0xca: return readFloat(4)
      case 0xcb: return readFloat(8)
      case 0xcc: return readUInt(1)
      case 0xcd: return readUInt(2)
      case 0xce: return readUInt(4)
      case 0xcf: return readBigUInt(8)
      case 0xd0: return readInt(1)
      case 0xd1: return readInt(2)
      case 0xd2: return readInt(4)
      case 0xd3: return readBigInt(8)
      case 0xd9: return readString(readUInt(1))
      case 0xda: return readString(readUInt(2))
      case 0xdb: return readString(readUInt(4))
      case 0xdc: return readArray(readUInt(2))
      case 0xdd: return readArray(readUInt(4))
      case 0xde: return readMap(readUInt(2))
      case 0xdf: return readMap(readUInt(4))
      default: throw new Error(`unsupported MessagePack prefix 0x${prefix.toString(16)}`)
    }
  }
  const ensure = (size: number) => {
    if (!Number.isSafeInteger(size) || size < 0 || offset + size > buffer.length) throw new Error('truncated MessagePack payload')
  }
  const readUInt = (size: number): number => {
    ensure(size)
    const value = size === 1 ? buffer.readUInt8(offset)
      : size === 2 ? buffer.readUInt16BE(offset)
        : buffer.readUInt32BE(offset)
    offset += size
    return value
  }
  const readBigUInt = (size: number): number | bigint => {
    ensure(size)
    const value = buffer.readBigUInt64BE(offset)
    offset += size
    return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value
  }
  const readInt = (size: number): number => {
    ensure(size)
    const value = size === 1 ? buffer.readInt8(offset)
      : size === 2 ? buffer.readInt16BE(offset)
        : buffer.readInt32BE(offset)
    offset += size
    return value
  }
  const readBigInt = (size: number): number | bigint => {
    ensure(size)
    const value = buffer.readBigInt64BE(offset)
    offset += size
    return value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER) ? Number(value) : value
  }
  const readFloat = (size: number): number => {
    ensure(size)
    const value = size === 4 ? buffer.readFloatBE(offset) : buffer.readDoubleBE(offset)
    offset += size
    return value
  }
  const readBinary = (size: number): Buffer => {
    ensure(size)
    const value = buffer.subarray(offset, offset + size)
    offset += size
    return value
  }
  const readString = (size: number): string => readBinary(size).toString('utf8')
  const readArray = (size: number): unknown[] => Array.from({ length: size }, () => read())
  const readMap = (size: number): Record<string, unknown> => {
    const output: Record<string, unknown> = {}
    for (let index = 0; index < size; index++) {
      const key = read()
      const value = read()
      output[String(key)] = value
    }
    return output
  }
  const result = read()
  if (offset !== buffer.length) throw new Error('MessagePack payload has trailing bytes')
  return result
}
