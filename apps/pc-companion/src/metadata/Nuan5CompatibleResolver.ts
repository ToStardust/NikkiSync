import type { InfinityPhotoMetadata } from '@nikkisync/core'
import type { PhotoMetadataResolveRequest, PhotoMetadataResolveResult, PhotoMetadataResolver } from './types.js'

export interface Nuan5CompatibleResolverConfig {
  endpoint?: string
  id?: string
  version?: string
  timeoutMs?: number
  /** Minimum delay between request starts; NUAN5 currently limits this to 0.5s per photo. */
  minIntervalMs?: number
}

type DecodedPhoto = Record<string, unknown>

function numberOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function buildEncodedTuple(request: PhotoMetadataResolveRequest): string {
  if (!request.nativeParamPayload || !request.nativeParamNuan5Md5) {
    throw new Error('NUAN5 resolver requires a native payload and locally derived JPEG-prefix MD5')
  }
  if (!/^[a-f0-9]{32}$/i.test(request.nativeParamNuan5Md5)) throw new Error('NUAN5 JPEG-prefix MD5 is invalid')
  const hashSegment = Buffer.from(request.nativeParamToken, 'base64')
  const dataSegment = Buffer.from(request.nativeParamPayload, 'base64')
  if (hashSegment.length === 0 || dataSegment.length === 0) throw new Error('NUAN5 embedded segments are invalid Base64')
  return Buffer.concat([hashSegment, dataSegment]).toString('base64')
}

function mapDecodedPhoto(photo: DecodedPhoto): Partial<InfinityPhotoMetadata> {
  const filter = recordOf(photo.filter)
  const light = recordOf(photo.light)
  const raw = recordOf(photo.raw)
  const time = recordOf(raw?.time)
  const pos = recordOf(raw?.pos)
  const camera: NonNullable<Partial<InfinityPhotoMetadata>['camera']> = {}
  const setCamera = (value: unknown, assign: (number: number) => void) => { const number = numberOf(value); if (number !== undefined) assign(number) }
  setCamera(photo.focal, (value) => { camera.focalLength = value }); setCamera(photo.apeture, (value) => { camera.apertureSection = value }); setCamera(photo.brightness, (value) => { camera.brightness = value }); setCamera(photo.exposure, (value) => { camera.exposure = value })
  setCamera(photo.contrast, (value) => { camera.contrast = value }); setCamera(photo.saturation, (value) => { camera.saturation = value }); setCamera(photo.vibrance, (value) => { camera.vibrance = value }); setCamera(photo.highlights, (value) => { camera.highlights = value })
  setCamera(photo.shadow, (value) => { camera.shadows = value }); setCamera(photo.vignette, (value) => { camera.vignetteIntensity = value }); setCamera(photo.bloomIntensity, (value) => { camera.bloomIntensity = value }); setCamera(photo.bloomThreshold, (value) => { camera.bloomThreshold = value })
  const filterMetadata: NonNullable<InfinityPhotoMetadata['filter']> = {}
  if (filter?.f !== undefined) filterMetadata.id = String(filter.f)
  const filterStrength = numberOf(filter?.s); if (filterStrength !== undefined) filterMetadata.strength = filterStrength
  const lightMetadata: NonNullable<InfinityPhotoMetadata['lighting']> = {}
  if (light?.l !== undefined) lightMetadata.id = String(light.l)
  const lightStrength = numberOf(light?.s); if (lightStrength !== undefined) lightMetadata.strength = lightStrength
  const coordinates: Record<string, number> = {}
  for (const key of ['x', 'y', 'z']) { const value = numberOf(pos?.[key]); if (value !== undefined) coordinates[key] = value }
  return {
    ...(Object.keys(camera).length ? { camera } : {}),
    ...(Object.keys(filterMetadata).length ? { filter: filterMetadata } : {}),
    ...(Object.keys(lightMetadata).length ? { lighting: lightMetadata } : {}),
    ...(Array.isArray(photo.clothes) ? { dressing: { clothes: photo.clothes } } : {}),
    ...(Object.keys(coordinates).length ? { location: { coordinates } } : {}),
    ...(time ? { photography: { time } } : {}),
    raw: { nuan5: photo }
  }
}

export class Nuan5CompatibleResolver implements PhotoMetadataResolver {
  readonly id: string
  readonly version: string | undefined
  private readonly endpoint: string
  private nextRequestAt = 0
  private requestGate: Promise<void> = Promise.resolve()

  constructor(private readonly config: Nuan5CompatibleResolverConfig = {}) {
    this.id = config.id ?? 'nuan5-compatible'
    this.version = config.version
    this.endpoint = config.endpoint ?? 'https://nuan5.pro/api/decode-photo2'
  }

  private async waitForRequestSlot(): Promise<void> {
    const previous = this.requestGate
    let release!: () => void
    this.requestGate = new Promise<void>((resolve) => { release = resolve })
    await previous
    try {
      const delay = this.nextRequestAt - Date.now()
      if (delay > 0) await new Promise<void>((resolve) => setTimeout(resolve, delay))
      // Keep a conservative margin over the server's documented 0.5s window.
      this.nextRequestAt = Date.now() + (this.config.minIntervalMs ?? 1000)
    } finally {
      release()
    }
  }

  async resolve(request: PhotoMetadataResolveRequest): Promise<PhotoMetadataResolveResult> {
    await this.waitForRequestSlot()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 12_000)
    try {
      const body = { photos: { [request.uid]: [[request.nativeParamNuan5Md5!, buildEncodedTuple(request)]] }, raw_data: true, raw_id: true }
      const response = await fetch(this.endpoint, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json', 'x-client': 'SpinningMomo' }, body: JSON.stringify(body), signal: controller.signal })
      const text = await response.text()
      if (!response.ok) throw new Error(`NUAN5 resolver HTTP ${response.status}: ${text.slice(0, 240)}`)
      const parsed = JSON.parse(text) as unknown
      if (!Array.isArray(parsed) || parsed.length !== 1 || !Array.isArray(parsed[0]) || parsed[0][0] !== request.uid || !Array.isArray(parsed[0][1]) || parsed[0][1].length !== 1) throw new Error('NUAN5 resolver returned an unexpected single-photo response')
      const item = parsed[0][1][0]
      if (typeof item === 'string') throw new Error(`NUAN5 resolver rejected photo: ${item}`)
      const photo = recordOf(item)
      if (!photo) throw new Error('NUAN5 resolver returned an invalid decoded photo')
      return { metadata: mapDecodedPhoto(photo), provider: this.id, ...(this.version ? { providerVersion: this.version } : {}), rawResponse: photo }
    } finally { clearTimeout(timer) }
  }
}
