import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, stat, writeFile, readdir,utimes } from 'node:fs/promises'
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

test('metadata thumbnail cache rejects unsafe URL, local targets, content type and oversized responses', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'nikkisync-metadata-thumb-safety-'))
  let requests = 0
  try {
    const cache = new MetadataThumbnailCache({
      cacheDir: directory,
      maxBytes: 4,
      fetchImpl: (async (input: string | URL | Request) => {
        requests++
        const url = String(input)
        if (url.endsWith('/html')) return new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } })
        return new Response(Buffer.from([1, 2, 3, 4, 5]), { status: 200, headers: { 'content-type': 'image/png' } })
      }) as typeof fetch
    })

    await assert.rejects(() => cache.get('http://images.example.test/plain.png', 'dict-v1'), /HTTPS/i)
    await assert.rejects(() => cache.get('https://localhost/private.png', 'dict-v1'), /local|private/i)
    await assert.rejects(() => cache.get('https://127.0.0.1/private.png', 'dict-v1'), /local|private/i)
    await assert.rejects(() => cache.get('https://192.168.1.8/private.png', 'dict-v1'), /local|private/i)
    assert.equal(requests, 0)

    await assert.rejects(() => cache.get('https://images.example.test/html', 'dict-v1'), /content type/i)
    await assert.rejects(() => cache.get('https://images.example.test/large.png', 'dict-v1'), /too large/i)
    assert.equal(requests, 2)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('shared icon disk cache bounds owned files and evicts old entries while retaining unrelated user files',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'nikki-cache-budget-'));let requests=0;
 try{
  await writeFile(path.join(directory,'user-note.txt'),'keep');
  const cache=new MetadataThumbnailCache({cacheDir:directory,maxBytes:8,maxCacheBytes:16,maxEntries:2,graceMs:0,fetchImpl:(async()=>{requests++;return new Response(Buffer.alloc(8,1),{headers:{'content-type':'image/png'}});}) as typeof fetch});
  const a=await cache.get('https://images.example.test/a');await utimes(a.path,new Date(1000),new Date(1000));const b=await cache.get('https://images.example.test/b');await cache.get('https://images.example.test/c');
  const files=await readdir(directory);assert.equal(files.filter(x=>x.endsWith('.img')).length,2);assert.ok(files.includes('user-note.txt'));await assert.rejects(()=>stat(a.path));assert.ok((await stat(b.path)).size);assert.equal(requests,3);
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('cached thumbnail content hash is verified and corrupt entries are fetched again',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'nikki-cache-digest-'));let requests=0;
 try{const cache=new MetadataThumbnailCache({cacheDir:directory,fetchImpl:(async()=>{requests++;return new Response(Buffer.from([1,2,3,4]),{headers:{'content-type':'image/png'}});}) as typeof fetch});const a=await cache.get('https://images.example.test/a');await writeFile(a.path,Buffer.from([4,3,2,1]));await cache.get('https://images.example.test/a');assert.equal(requests,2);}finally{await rm(directory,{recursive:true,force:true});}
});

test('shared icon download deadline includes a stalled response body after successful headers',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'nikki-cache-body-timeout-'));let controller:ReadableStreamDefaultController<Uint8Array>|undefined;
 try{const cache=new MetadataThumbnailCache({cacheDir:directory,timeoutMs:20,fetchImpl:(async(_input:unknown,init?:RequestInit)=>{
  const stream=new ReadableStream<Uint8Array>({start(value){controller=value;value.enqueue(Uint8Array.from([1,2,3,4]));}});
  init?.signal?.addEventListener('abort',()=>controller?.error(new Error('Aborted body')),{once:true});return new Response(stream,{headers:{'content-type':'image/png'}});
 }) as typeof fetch});const result=await Promise.race([cache.get('https://images.example.test/stalled').then(()=>false,()=>true),new Promise(resolve=>setTimeout(()=>resolve('slow'),100))]);assert.equal(result,true);assert.equal((await readdir(directory)).length,0);
 }finally{controller?.error(new Error('Test cleanup'));await rm(directory,{recursive:true,force:true});}
});
