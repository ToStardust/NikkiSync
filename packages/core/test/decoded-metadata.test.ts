import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeNuan5Photo, normalizeNikkiGalleryPhoto, mergePhotoMetadataGaps } from '../src/index.js'

test('decoded metadata exposes existing action, eureka, interaction and camera fields without guessing names', () => {
  const metadata = normalizeNuan5Photo({ focal: 50, rotation: -12.5, hide_nikki: false, vertical: true,
    pose: 1090010002, filter: { f: 1090020014, s: 100 }, light: { l: 1090030013, s: 50 },
    clothes: [1020300419], eurekas: [{ e: 718197802, c: 0 }], interactions: [{ i: 800002 }],
    diy: { '1020300419': { color: 3 } }, raw: { time: { h: 15 }, pos: { x: 1, y: 2, z: 3 } } })
  assert.deepEqual(metadata.pose, { id: '1090010002' })
  assert.equal(metadata.camera?.rotation, -12.5)
  assert.equal(metadata.nikki?.hidden, false)
  assert.equal(metadata.photography?.vertical, true)
  assert.deepEqual(metadata.dressing?.eureka, [{ e: 718197802, c: 0, id: '718197802' }])
  assert.deepEqual(metadata.interactions, [{ i: 800002, id: '800002' }])
  assert.deepEqual(metadata.dressing?.diy, { '1020300419': { color: 3 } })
  assert.equal(metadata.filter?.name, undefined)
  assert.deepEqual(metadata.filter, { id: '1090020014', strength: 100 })
  assert.deepEqual(metadata.lighting, { id: '1090030013', strength: 50 })
  assert.deepEqual(metadata.location?.coordinates, { x: 1, y: 2, z: 3 })
})

test('NikkiGallery decoded results use the same mobile fields as NUAN5', () => {
  const metadata = normalizeNikkiGalleryPhoto({ hasParams: true,
    camera: { focalLength: 50, brightness: 0, rotation: 90, pose: 1090010002,
      filter: { id: 'Fresh_001', strength: 80 }, light: { id: 'DirectionLight_L', strength: 50 } },
    dressing: { clothes: [{ id: 1020300419, clothType: 30, state: 0 }], eureka: [{ id: 718197802, level: 1 }] },
    photography: { weather: 0, location: { pos: { x: 1, y: 2, z: 3 } } },
    nikki: { hidden: false }, interactions: { mount: null, carrier: null, interactions: [{ id: 800002 }] } })
  assert.deepEqual(metadata.pose, { id: '1090010002' })
  assert.deepEqual(metadata.filter, { id: 'Fresh_001', strength: 80 })
  assert.deepEqual(metadata.lighting, { id: 'DirectionLight_L', strength: 50 })
  assert.equal(metadata.camera?.brightness, 0)
  assert.equal(metadata.camera?.rotation, 90)
  assert.deepEqual(metadata.interactions, [{ id: '800002' }])
  assert.equal((metadata.dressing?.clothes?.[0] as any).clothType, 30)
  assert.equal((metadata.dressing?.clothes?.[0] as any).category, undefined, 'category comes from the exact-ID dictionary')
  assert.deepEqual(metadata.location?.coordinates, { x: 1, y: 2, z: 3 })
  assert.equal(normalizeNikkiGalleryPhoto({ hasParams: false }).camera, undefined)
})

test('same-photo gap merging preserves edits and fills exact matching clothing fields', () => {
  const primary = { camera: { brightness: 0, rotation: 180 }, pose: { id: '1', name: '我的动作名' },
    dressing: { clothes: [{ id: '10', name: '我的服装名' }] } }
  const result = mergePhotoMetadataGaps(primary, { camera: { brightness: 30, focalLength: 50 },
    pose: { id: '1', name: '上游名称' }, dressing: { clothes: [{ id: '10', name: '字典名', category: 'tops' }, { id: '20' }] } })
  assert.deepEqual(result.camera, { brightness: 0, rotation: 180, focalLength: 50 })
  assert.equal(result.pose?.name, '我的动作名')
  assert.deepEqual(result.dressing?.clothes, [{ id: '10', name: '我的服装名', category: 'tops' }])
  assert.deepEqual(primary.dressing.clothes, [{ id: '10', name: '我的服装名' }])
  assert.deepEqual(mergePhotoMetadataGaps({ dressing: { clothes: [] } }, { dressing: { clothes: [10] } }).dressing?.clothes, [])
  const polluted = normalizeNuan5Photo(JSON.parse('{"pose":null,"rotation":"bad","clothes":[],"__proto__":{"polluted":true}}'))
  assert.equal(polluted.pose, undefined)
  assert.equal(polluted.camera?.rotation, undefined)
  assert.equal(({} as any).polluted, undefined)
})
