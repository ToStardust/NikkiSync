import type { InfinityPhotoMetadata } from './types.js'

type ObjectValue = Record<string, unknown>
function object(value: unknown): ObjectValue | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : undefined
}
function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}
function identifier(value: unknown): string | undefined {
  if (typeof value !== 'string' && !(typeof value === 'number' && Number.isSafeInteger(value))) return undefined
  const id = String(value).trim()
  return id && id.toLowerCase() !== 'none' ? id : undefined
}
function clone(value: unknown): any {
  if (Array.isArray(value)) return value.map(clone)
  const source = object(value)
  if (!source) return value
  return Object.fromEntries(Object.entries(source).filter(([key]) => !['__proto__', 'constructor', 'prototype'].includes(key))
    .map(([key, item]) => [key, clone(item)]))
}
function effect(value: unknown, idKey = 'id', strengthKey = 'strength'): { id?: string; name?: string; strength?: number } | undefined {
  const source = object(value)
  if (!source) return undefined
  const id = identifier(source[idKey]), strength = number(source[strengthKey])
  const name = typeof source.name === 'string' && source.name.trim() ? source.name : undefined
  return id || name || strength !== undefined ? { ...(id ? { id } : {}), ...(name ? { name } : {}),
    ...(strength === undefined ? {} : { strength }) } : undefined
}
function entities(value: unknown, idKey: string): unknown[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.map(item => {
    const source = object(item), id = identifier(source?.[idKey] ?? source?.id ?? item)
    return source ? { ...clone(source), ...(id ? { id } : {}) } : item
  })
}

/** Canonical fields shared by both PC backends. Unknown names/IDs are never inferred. */
export function normalizeNuan5Photo(value: unknown): Partial<InfinityPhotoMetadata> {
  const photo = object(value)
  if (!photo) return {}
  const camera: InfinityPhotoMetadata['camera'] = {}
  const fields = { focal: 'focalLength', apeture: 'apertureSection', brightness: 'brightness', exposure: 'exposure',
    contrast: 'contrast', saturation: 'saturation', vibrance: 'vibrance', highlights: 'highlights', shadow: 'shadows',
    vignette: 'vignetteIntensity', bloomIntensity: 'bloomIntensity', bloomThreshold: 'bloomThreshold', rotation: 'rotation' } as const
  for (const [source, target] of Object.entries(fields)) {
    const value = number(photo[source]); if (value !== undefined) (camera as ObjectValue)[target] = value
  }
  const filter = effect(photo.filter, 'f', 's'), lighting = effect(photo.light, 'l', 's')
  const raw = object(photo.raw), time = object(raw?.time), pos = object(raw?.pos)
  const coordinates: Record<string, number> = {}
  for (const key of ['x', 'y', 'z']) { const v = number(pos?.[key]); if (v !== undefined) coordinates[key] = v }
  const pose = identifier(photo.pose)
  const eureka = entities(photo.eurekas, 'e'), interactions = entities(photo.interactions, 'i')
  const dressing = { ...(Array.isArray(photo.clothes) ? { clothes: clone(photo.clothes) as unknown[] } : {}),
    ...(eureka ? { eureka } : {}), ...(object(photo.diy) ? { diy: clone(photo.diy) } : {}) }
  const photography = { ...(time ? { time: clone(time) } : typeof photo.time === 'string' ? { time: photo.time } : {}),
    ...(typeof photo.weather === 'string' ? { weather: photo.weather } : {}),
    ...(typeof photo.vertical === 'boolean' ? { vertical: photo.vertical } : {}) }
  return {
    ...(Object.keys(camera).length ? { camera } : {}), ...(filter ? { filter } : {}), ...(lighting ? { lighting } : {}),
    ...(pose ? { pose: { id: pose } } : {}), ...(Object.keys(dressing).length ? { dressing } : {}),
    ...(Object.keys(photography).length ? { photography } : {}),
    ...(typeof photo.hide_nikki === 'boolean' ? { nikki: { hidden: photo.hide_nikki } } : {}),
    ...(interactions ? { interactions } : {}),
    ...(Object.keys(coordinates).length ? { location: { coordinates } } : {}), raw: { nuan5: clone(photo) }
  }
}

/** Accept the result of NikkiGallery decrypt:decodeFile, including its IPC envelope. No file or DLL execution here. */
export function normalizeNikkiGalleryPhoto(value: unknown): Partial<InfinityPhotoMetadata> {
  const envelope = object(value), photo = object(envelope?.data) ?? envelope
  if (!photo || photo.hasParams !== true) return {}
  const source = object(photo.camera), camera: InfinityPhotoMetadata['camera'] = {}
  for (const key of ['focalLength', 'apertureSection', 'brightness', 'exposure', 'contrast', 'saturation', 'vibrance',
    'highlights', 'shadows', 'vignetteIntensity', 'bloomIntensity', 'bloomThreshold', 'rotation', 'zoom', 'cameraYaw', 'cameraPitch'] as const) {
    const v = number(source?.[key]); if (v !== undefined) camera[key] = v
  }
  if (typeof source?.portraitMode === 'boolean') camera.portraitMode = source.portraitMode
  if (object(source?.cameraLoc)) camera.cameraLoc = clone(source?.cameraLoc)
  const filter = effect(source?.filter), lighting = effect(source?.light), pose = identifier(source?.pose)
  const originalDressing = object(photo.dressing)
  // Exact-ID dictionaries supply canonical categories; retain the decoder's type without guessing across schemas.
  const clothes = entities(originalDressing?.clothes, 'id')
  const dressing = originalDressing ? { ...clone(originalDressing), ...(clothes ? { clothes } : {}),
    ...(Array.isArray(originalDressing.eureka) ? { eureka: entities(originalDressing.eureka, 'id') } : {}) } : undefined
  const photography = object(photo.photography), location = object(photography?.location), coordinates = object(location?.pos)
  const objects = object(photo.interactions), interactions = entities(objects?.interactions ?? photo.interactions, 'id')
  return {
    ...(Object.keys(camera).length ? { camera } : {}), ...(filter ? { filter } : {}), ...(lighting ? { lighting } : {}),
    ...(pose ? { pose: { id: pose } } : {}), ...(dressing ? { dressing } : {}),
    ...(photography ? { photography: clone(photography) } : {}), ...(object(photo.nikki) ? { nikki: clone(photo.nikki) } : {}),
    ...(coordinates ? { location: { coordinates: clone(coordinates) } } : {}), ...(interactions ? { interactions } : {})
  }
}

/** Fill gaps for the SAME photo. Existing values and array membership (including explicit empty lists) win. */
export function mergePhotoMetadataGaps<T extends Partial<InfinityPhotoMetadata>>(primary: T, supplement: Partial<InfinityPhotoMetadata>): T {
  function fill(target: unknown, source: unknown): any {
    if (target === undefined || target === null) return clone(source)
    if (Array.isArray(target) && Array.isArray(source)) {
      const byId = new Map(source.flatMap(item => {
        const entity = object(item), id = identifier(entity?.id)
        return id ? [[id, entity] as const] : []
      }))
      return target.map(item => { const entity = object(item), id = identifier(entity?.id)
        return entity && id && byId.has(id) ? fill(entity, byId.get(id)) : clone(item) })
    }
    const left = object(target), right = object(source)
    if (!left || !right) return clone(target)
    if (left.id !== undefined && right.id !== undefined && String(left.id) !== String(right.id)) return clone(left)
    const result = clone(left)
    for (const [key, value] of Object.entries(right)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) continue
      result[key] = fill(result[key], value)
    }
    return result
  }
  return fill(primary, supplement)
}
