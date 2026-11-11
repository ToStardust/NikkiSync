import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { normalizeNikkiGalleryPhoto } from '@nikkisync/core'
import type { MetadataResolutionOutcome, PhotoMetadataResolveRequest, PhotoMetadataResolver } from './types.js'

const APERTURE_F_NUMBERS = [undefined, 1.2, 1.4, 2, 2.2, 2.5, 2.8, 3.2, 3.5, 4, 4.5, 5, 5.6, 8, 11, 16]

function parseLocalPhoto(cameraText: string, photoText: string) {
  const text = cameraText.trim()
  // Some originals carry opaque padding after the complete camera array.
  const array = /^\[(?:"(?:\\.|[^"\\])*"|[^"[\]])*\]/.exec(text)?.[0]
  const values: unknown = text.startsWith('{') ? JSON.parse(text).camera
    : text.startsWith('[') ? array && JSON.parse(array) : text.split(',')
  if (!Array.isArray(values) || values.length < 31 || !Number.isFinite(Number(values[14]))) {
    throw new Error('Invalid local camera parameters')
  }
  const previousCamera = Object.fromEntries(Object.entries({
    focalLength: 14, apertureSection: 15, vignetteIntensity: 19, bloomIntensity: 20,
    bloomThreshold: 21, brightness: 22, exposure: 23, contrast: 24, saturation: 25,
    vibrance: 26, highlights: 27, shadows: 28
  }).map(([name, index]) => [name, Number(values[index])]))
  // Some originals contain bare enum tokens outside PhotoInfo. Read its named numbers
  // independently, since the companion CameraParams array rounds away their precision.
  const infoStart = /"(?:PhotoInfo|photoInfo)"\s*:\s*\{/.exec(photoText)?.index
  const photoInfo = infoStart === undefined ? '' : photoText.slice(infoStart)
  const photoNumber = (key: string): number | undefined => {
    const token = new RegExp(`"${key}"\\s*:\\s*(-?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)(?=\\s*[,}])`).exec(photoInfo)?.[1]
    return token === undefined ? undefined : Number(token)
  }
  // Nikki Albums publishes the slider conversion and aperture flags. NUAN5 presents
  // these three slider percentages truncated to one decimal place.
  const percent = (fraction: number) => Math.trunc(Number((fraction * 1000).toFixed(9))) / 10
  const focal = previousCamera.focalLength!
  const camera = {
    ...previousCamera,
    focalLength: Math.round((photoNumber('cameraFocalLength') ?? (focal >= 0 && focal <= 1 ? 10 + focal * 45 : focal)) * 10) / 10,
    apertureSection: APERTURE_F_NUMBERS[previousCamera.apertureSection!],
    rotation: Number(values[16]),
    vignetteIntensity: Math.round((photoNumber('vignetteIntensity') ?? previousCamera.vignetteIntensity!) * 100),
    bloomIntensity: percent(previousCamera.bloomIntensity! / 8),
    brightness: percent((previousCamera.brightness! - 0.3) / 1.2),
    contrast: percent((previousCamera.contrast! - 0.55) / 1.45),
    vibrance: Math.round(previousCamera.vibrance! * 200) / 100
  }
  const effect = (index: number) => {
    const id = String(values[index] ?? '').trim()
    return id && id.toLowerCase() !== 'none' ? { id, strength: Number(values[index + 1]) } : undefined
  }
  const oldLight = effect(17), oldFilter = effect(29)
  const withPercent = (value: ReturnType<typeof effect>, key: string) => value && {
    ...value, strength: Math.round((photoNumber(key) ?? value.strength) * 100)
  }
  // The surrounding game object can contain bare enum values. The outfit lists are JSON arrays.
  const readIds = (keys: string) => {
    const list = new RegExp(`"(?:${keys})"\\s*:\\s*(\\[[^\\[\\]]*\\])`).exec(photoText)?.[1]
    if (list === undefined) return undefined
    try {
      return (JSON.parse(list) as unknown[]).flatMap(item => {
        const id = typeof item === 'object' && item !== null ? (item as { id?: unknown }).id : item
        return /^(?:[1-9]\d{0,11})$/.test(String(id)) ? [{ id: String(id) }] : []
      })
    } catch { return undefined }
  }
  const clothes = readIds('nikkiClothes|nikki_clothes|NikkiClothes')
  const eureka = readIds('magicballColorIds|magicball_color_ids|MagicballColorIds')
  const pose = /"(?:pose_id|poseId|PoseId)"\s*:\s*"?([1-9]\d{0,11})(?="|[,}\s])/.exec(photoText)?.[1]
  const metadata = normalizeNikkiGalleryPhoto({
    hasParams: true,
    camera: { ...camera, portraitMode: Number(values[1]) === 1,
      filter: withPercent(oldFilter, 'filterStrength'), light: withPercent(oldLight, 'lightStrength'), pose },
    ...(clothes || eureka ? { dressing: { ...(clothes ? { clothes } : {}), ...(eureka ? { eureka } : {}) } } : {})
  })
  return { metadata, previousLocalValues: { camera: previousCamera,
    ...(oldFilter ? { filter: oldFilter } : {}), ...(oldLight ? { lighting: oldLight } : {}) } }
}

export function parseLocalPhotoMetadata(cameraText: string, photoText: string) {
  return parseLocalPhoto(cameraText, photoText).metadata
}

export function createLocalPhotoMetadataResolver(
  executable: string | undefined,
  directory: string,
  online: PhotoMetadataResolver | undefined,
  onlineEnabled: () => boolean
): PhotoMetadataResolver | undefined {
  if (process.platform !== 'win32' || !executable || !path.isAbsolute(executable)
    || !existsSync(path.join(directory, 'nuan5_decryption.dll'))) return undefined
  const id = 'local-photo'
  const version = '2'
  return withLocalPhotoFallback({
    id, version, usesPhotoFile: true,
    async resolve({ sourcePhotoPath, sourcePhotoSha256, uid, signal }) {
      if (!sourcePhotoPath || !sourcePhotoSha256) throw new Error('No original photo available for local decoding')
      const stdout = await new Promise<string>((resolve, reject) => {
        const child = execFile(executable, ['--decode-photo-local'], {
          cwd: directory, windowsHide: true, timeout: 12_000, maxBuffer: 5 * 1024 * 1024,
          ...(signal ? { signal } : {})
        }, (error, output) => {
          if (error) reject(new Error('Local photo decoder rejected the input'))
          else resolve(output)
        })
        child.stdin?.on('error', () => {})
        child.stdin?.end(JSON.stringify({ file: sourcePhotoPath, sha256: sourcePhotoSha256, uid }))
      })
      const { camera, photo } = JSON.parse(stdout) as { camera: string; photo: string }
      return { provider: id, providerVersion: version, ...parseLocalPhoto(camera, photo) }
    }
  }, online, onlineEnabled)
}

export function withLocalPhotoFallback(
  local: PhotoMetadataResolver, online: PhotoMetadataResolver | undefined, onlineEnabled: () => boolean
): PhotoMetadataResolver {
  if (!online) return local
  const current = (request: PhotoMetadataResolveRequest) => !request.signal?.aborted && request.isCurrent?.() !== false
  const forOnline = ({ sourcePhotoPath, sourcePhotoSha256, localOnly, ...request }: PhotoMetadataResolveRequest) => request
  const fallback: PhotoMetadataResolver = {
    id: local.id, ...(local.usesPhotoFile ? { usesPhotoFile: true } : {}),
    get version() { return onlineEnabled() ? `${local.version ?? 'local'}+online` : local.version },
    get batchSize() { return onlineEnabled() ? online.batchSize ?? 12 : 12 },
    async resolve(request, database) {
      if (!database) return local.resolve(request)
      const [result] = await fallback.resolveBatch!([request], database)
      if (result?.status === 'fulfilled') return result.value
      throw result?.reason
    },
    async resolveBatch(requests, database) {
      const outcomes: MetadataResolutionOutcome[] = []
      const failed: Array<{ request: PhotoMetadataResolveRequest; index: number }> = []
      for (const [index, request] of requests.entries()) {
        try {
          if (!current(request)) throw new Error('Local decode cancelled')
          outcomes[index] = { status: 'fulfilled', value: await local.resolve(request) }
        } catch (reason) {
          outcomes[index] = { status: 'rejected', reason }
          const hadOriginal = !local.usesPhotoFile || !!(request.sourcePhotoPath && request.sourcePhotoSha256)
          if (hadOriginal && !request.localOnly && current(request)) failed.push({ index, request: forOnline(request) })
        }
      }
      const eligible = failed.filter(item => current(item.request))
      if (!eligible.length || !onlineEnabled()) return outcomes
      if (online.resolveBatch) {
        const results = await online.resolveBatch(eligible.map(item => item.request), database)
        eligible.forEach(({ index }, position) => { outcomes[index] = results[position]! })
      } else {
        for (const { index, request } of eligible) {
          if (!onlineEnabled() || !current(request)) continue
          try { outcomes[index] = { status: 'fulfilled', value: await online.resolve(request, database) } }
          catch (reason) { outcomes[index] = { status: 'rejected', reason } }
        }
      }
      return outcomes
    }
  }
  return fallback
}
