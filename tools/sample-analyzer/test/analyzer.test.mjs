import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { analyzeSamples } from '../analyze.mjs'

test('synthetic High/Low/Motion/JPEG-tail fixture produces both reports', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'nikkisync-analyzer-'))
  try {
    const high = path.join(root, 'GamePlayPhotos', '10001', 'NikkiPhotos_HighQuality')
    const low = path.join(root, 'GamePlayPhotos', '10001', 'NikkiPhotos_LowQuality')
    const video = path.join(root, 'Video', '10001')
    const output = path.join(root, 'report')
    await Promise.all([high, low, video].map((directory) => mkdir(directory, { recursive: true })))

    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9])
    await writeFile(path.join(high, 'Photo_123456.jpg'), Buffer.concat([jpeg, Buffer.from('NIKKI_TRAILING_PAYLOAD')]))
    await writeFile(path.join(low, 'Photo_123456.jpg'), jpeg)
    await writeFile(path.join(video, 'Photo_123456.mp4'), Buffer.from('synthetic mp4 fixture'))
    await writeFile(path.join(video, 'Photo_123456_cover.jpg'), jpeg)
    await writeFile(path.join(root, 'diagnostic.bin'), Buffer.from('synthetic companion payload'))
    const timestamp = new Date('2026-01-01T00:00:00.000Z')
    await Promise.all([
      path.join(high, 'Photo_123456.jpg'),
      path.join(low, 'Photo_123456.jpg'),
      path.join(video, 'Photo_123456.mp4'),
      path.join(video, 'Photo_123456_cover.jpg')
    ].map((file) => utimes(file, timestamp, timestamp)))

    await analyzeSamples({
      roots: [root],
      output,
      ffprobe: 'nikkisync-missing-ffprobe',
      maxFiles: 100
    })

    const report = JSON.parse(await readFile(path.join(output, 'analysis-report.json'), 'utf8'))
    assert.equal(report.summary.highQuality, 1)
    assert.equal(report.summary.lowQuality, 1)
    assert.equal(report.summary.videos, 1)
    assert.equal(report.summary.binaries, 1)
    assert.equal(report.summary.jpegWithTrailingData, 1)
    assert.equal(report.summary.deterministicMotionPairs, 1)
    assert.equal(report.resolverVersion, 1)
    assert.match(report.records.find((record) => record.pathClass === 'high_quality_photo').image.jpegTail.trailingPayload.sha256, /^[a-f0-9]{64}$/)
    assert.equal(report.motionCandidates[0].candidates[0].method, 'filename')
    assert.match(await readFile(path.join(output, 'analysis-report.md'), 'utf8'), /静态图 ↔ 视频候选/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
