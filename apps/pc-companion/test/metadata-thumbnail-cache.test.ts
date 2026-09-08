import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { MetadataThumbnailCache } from '../src/metadata/MetadataThumbnailCache.js'

function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

test('metadata thumbnail cache downloads an HTTPS image once and reuses the cached file', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'nikkisync-metadata-thumb-'))
  const image = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4])
  let requests = 0
  const fetchImpl = (async (input: string | URL | Request) => {
    requests++
    assert.equal(String(input), 'https://images.example.test/cloth/1020810145.png')
    return new Response(image, {
      status: 200,
      headers: { 'content-type': 'image/png', 'content-length': String(image.length) }
    })
  }) as typeof fetch

  try {
    const cache = new MetadataThumbnailCache({ cacheDir: directory, maxBytes: 1024, fetchImpl })
    const first = await cache.get('https://images.example.test/cloth/1020810145.png', 'dict-v1')
    const second = await cache.get('https://images.example.test/cloth/1020810145.png', 'dict-v1')

    assert.equal(requests, 1)
    assert.equal(first.path, second.path)
    assert.equal(first.mimeType, 'image/png')
    assert.equal(first.sizeBytes, image.length)
    assert.equal(first.sha256, sha256(image))
    assert.equal((await stat(first.path)).size, image.length)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('metadata thumbnail cache rejects unsafe URL, content type and oversized responses', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'nikkisync-metadata-thumb-safety-'))
  try {
    const cache = new MetadataThumbnailCache({
      cacheDir: directory,
      maxBytes: 4,
      fetchImpl: (async (input: string | URL | Request) => {
        const url = String(input)
        if (url.endsWith('/html')) return new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } })
        return new Response(Buffer.from([1, 2, 3, 4, 5]), { status: 200, headers: { 'content-type': 'image/png' } })
      }) as typeof fetch
    })

    await assert.rejects(() => cache.get('http://images.example.test/plain.png', 'dict-v1'), /HTTPS/i)
    await assert.rejects(() => cache.get('https://images.example.test/html', 'dict-v1'), /content type/i)
    await assert.rejects(() => cache.get('https://images.example.test/large.png', 'dict-v1'), /too large/i)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
