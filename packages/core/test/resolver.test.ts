import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AssetResolver, toPathKey, type ResolverResourceInput } from '../src/index.js'

const resolver = new AssetResolver()
const time = '2026-01-01T00:00:00.000Z'

function resource(resourceId: string, fileName: string, extra: Partial<ResolverResourceInput> = {}): ResolverResourceInput {
  return { resourceId, fileName, modifiedAt: time, ...extra }
}

test('exact filename, timestamp and UID produce a strong match', () => {
  const result = resolver.scoreCandidate(
    resource('still', 'Photo_123456.jpg', { uid: '10001' }),
    resource('motion', 'Photo_123456.mp4', { uid: '10001', durationMs: 3000 })
  )
  assert.equal(result.method, 'filename')
  assert.ok(result.reasons.includes('basename_exact:+90'))
  assert.ok(result.reasons.includes('uid_equal:+25'))
  assert.ok(result.score > 0)
})

test('different UID is penalized', () => {
  const result = resolver.scoreCandidate(
    resource('still', 'still.jpg', { uid: '10001' }),
    resource('motion', 'motion.mp4', { uid: '10002' })
  )
  assert.ok(result.reasons.includes('uid_different:reject'))
  assert.equal(result.score, -1)
  assert.equal(result.confidence, 0)
})

test('impossible time difference is rejected by score', () => {
  const result = resolver.scoreCandidate(
    resource('still', 'still.jpg', { modifiedAt: time }),
    resource('motion', 'motion.mp4', { modifiedAt: '2026-01-01T01:00:00.000Z' })
  )
  assert.ok(result.score < 0)
  assert.ok(result.reasons.some((reason) => reason.startsWith('impossible_time_difference')))
})

test('candidate sorting is deterministic for ties', () => {
  const results = resolver.resolveMotionCandidates(
    [resource('still', 'photo.jpg')],
    [resource('motion-b', 'photo.mp4'), resource('motion-a', 'photo.mov')]
  )
  assert.deepEqual(results.map((item) => item.motionResourceId), ['motion-a', 'motion-b'])
})

test('same UID and stem deterministically aggregate HighQuality and LowQuality', () => {
  const groups = resolver.resolvePhotoResources([
    resource('low', '2026_04_01_01_02_03_123.jpeg', { uid: '10001', role: 'source_low_quality' }),
    resource('high', '2026_04_01_01_02_03_123.jpeg', { uid: '10001', role: 'source_high_quality' })
  ])
  assert.equal(groups.length, 1)
  assert.equal(groups[0]?.primaryResourceId, 'high')
  assert.equal(groups[0]?.confidence, 1)
  assert.deepEqual(groups[0]?.resources.map((item) => item.resourceId), ['high', 'low'])
})

test('same filename under different UIDs remains separate', () => {
  const groups = resolver.resolvePhotoResources([
    resource('a', 'photo.jpeg', { uid: '10001', role: 'source_high_quality' }),
    resource('b', 'photo.jpeg', { uid: '10002', role: 'source_low_quality' })
  ])
  assert.equal(groups.length, 2)
})

test('cover and MP4 in the same bundle resolve as a deterministic motion asset', () => {
  const result = resolver.scoreCandidate(
    resource('cover', '2026_04_28_20_07_46_396732_cover.jpeg', {
      uid: '10001',
      sourcePath: 'C:\\GamePlayPhotos\\10001\\Videos\\bundle\\2026_04_28_20_07_46_396732_cover.jpeg'
    }),
    resource('motion', '2026_04_28_20_07_46_396732.Mp4', {
      uid: '10001',
      sourcePath: 'C:\\GamePlayPhotos\\10001\\Videos\\bundle\\2026_04_28_20_07_46_396732.Mp4',
      durationMs: 7700
    })
  )
  assert.equal(result.method, 'filename')
  assert.equal(result.confidence, 1)
  assert.ok(result.reasons.includes('motion_cover_stem_exact:+140'))
  assert.ok(result.reasons.includes('same_parent_directory:+30'))
})

test('Windows path keys are slash-normalized and case-insensitive', () => {
  assert.equal(toPathKey('C:\\ABC\\File.JPG', 'win32'), toPathKey('c:\\abc\\file.jpg', 'win32'))
})
