#!/usr/bin/env node
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFile } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { ASSET_RESOLVER_VERSION, AssetResolver } from '@nikkisync/core'

const execFileAsync = promisify(execFile)
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.heic', '.heif', '.avif', '.webp'])
const VIDEO_EXTS = new Set(['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi'])
const BINARY_EXTS = new Set(['.bin'])

function parseArgs(argv) {
  const out = { roots: [], output: path.resolve('nikkisync-sample-report'), ffprobe: 'ffprobe', maxFiles: 5000 }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--root') out.roots.push(path.resolve(argv[++i]))
    else if (a === '--output') out.output = path.resolve(argv[++i])
    else if (a === '--ffprobe') out.ffprobe = argv[++i]
    else if (a === '--max-files') out.maxFiles = Number(argv[++i])
    else if (a === '--help' || a === '-h') out.help = true
    else if (!a.startsWith('-')) out.roots.push(path.resolve(a))
    else throw new Error(`Unknown argument: ${a}`)
  }
  return out
}

function usage() {
  console.log(`NikkiSync M0.16 Sample Analyzer\n\nUsage:\n  node analyze.mjs --root <GamePlayPhotos-or-X6Game> [--root <Video>] --output <dir>\n\nOptions:\n  --root <path>       Repeatable sample root\n  --output <dir>      Report directory (default: ./nikkisync-sample-report)\n  --ffprobe <path>    ffprobe executable (default: ffprobe)\n  --max-files <n>     Safety limit (default: 5000)\n`)
}

async function* walk(root) {
  const stack = [root]
  while (stack.length) {
    const current = stack.pop()
    let entries
    try { entries = await fsp.readdir(current, { withFileTypes: true }) }
    catch (e) { yield { error: `readdir failed: ${current}: ${e.message}` }; continue }
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) stack.push(full)
      else if (entry.isFile()) yield { file: full }
    }
  }
}

function inferUid(filePath) {
  const parts = filePath.split(/[\\/]+/)
  const gp = parts.findIndex(p => p.toLowerCase() === 'gameplayphotos')
  const candidates = gp >= 0 ? parts.slice(gp + 1) : parts
  for (const p of candidates) if (/^\d{5,20}$/.test(p)) return p
  return undefined
}

function classifyPath(filePath) {
  const p = filePath.replaceAll('\\', '/').toLowerCase()
  if (p.includes('nikkiphotos_highquality')) return 'high_quality_photo'
  if (p.includes('nikkiphotos_lowquality')) return 'low_quality_photo'
  if (/\/videos?\//.test(p)) return 'motion_or_video'
  if (p.includes('/diy/') && BINARY_EXTS.has(path.extname(p))) return 'diy_binary'
  if (p.includes('screenshot')) return 'screenshot'
  if (IMAGE_EXTS.has(path.extname(p))) return 'image_other'
  if (VIDEO_EXTS.has(path.extname(p))) return 'video_other'
  return 'other'
}

function mimeFromExt(ext) {
  return ({
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
    '.heic': 'image/heic', '.heif': 'image/heif', '.avif': 'image/avif',
    '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.m4v': 'video/x-m4v', '.webm': 'video/webm',
    '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo', '.bin': 'application/octet-stream'
  })[ext] ?? 'application/octet-stream'
}

async function sha256File(filePath) {
  const hash = crypto.createHash('sha256')
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath)
    stream.on('data', chunk => hash.update(chunk))
    stream.on('end', resolve)
    stream.on('error', reject)
  })
  return hash.digest('hex')
}

async function readPrefix(filePath, max = 2 * 1024 * 1024) {
  const fh = await fsp.open(filePath, 'r')
  try {
    const stat = await fh.stat()
    const size = Math.min(stat.size, max)
    const buf = Buffer.alloc(size)
    await fh.read(buf, 0, size, 0)
    return buf
  } finally { await fh.close() }
}

function jpegDimensions(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return undefined
  let i = 2
  while (i + 8 < buf.length) {
    if (buf[i] !== 0xff) { i++; continue }
    while (buf[i] === 0xff) i++
    const marker = buf[i++]
    if (marker === 0xd9 || marker === 0xda) break
    if (i + 2 > buf.length) break
    const len = buf.readUInt16BE(i)
    if (len < 2 || i + len > buf.length) break
    const sof = new Set([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf])
    if (sof.has(marker) && len >= 7) {
      return { height: buf.readUInt16BE(i + 3), width: buf.readUInt16BE(i + 5) }
    }
    i += len
  }
  return undefined
}

function pngDimensions(buf) {
  if (buf.length < 24 || buf.toString('hex', 0, 8) !== '89504e470d0a1a0a') return undefined
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

async function scanJpegEoi(filePath) {
  let absolute = 0
  let prev = -1
  const offsets = []
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath, { highWaterMark: 1024 * 1024 })
    stream.on('data', chunk => {
      for (let i = 0; i < chunk.length; i++) {
        const b = chunk[i]
        if (prev === 0xff && b === 0xd9) offsets.push(absolute + i - 1)
        prev = b
      }
      absolute += chunk.length
    })
    stream.on('end', resolve)
    stream.on('error', reject)
  })
  const size = absolute
  if (!offsets.length) return { eoiCount: 0 }
  const first = offsets[0] + 2
  const last = offsets[offsets.length - 1] + 2
  const trailingBytesAfterFirstEoi = size - first
  const trailingPayload = trailingBytesAfterFirstEoi > 0
    ? await inspectPayload(filePath, first, trailingBytesAfterFirstEoi)
    : undefined
  const trailingPayloadAfterLastEoi = size - last > 0
    ? await inspectPayload(filePath, last, size - last)
    : undefined
  return {
    eoiCount: offsets.length,
    firstEoiEndOffset: first,
    lastEoiEndOffset: last,
    trailingBytesAfterFirstEoi,
    trailingBytesAfterLastEoi: size - last,
    trailingPayload,
    trailingPayloadAfterLastEoi
  }
}

async function inspectPayload(filePath, start, length) {
  const prefixLength = Math.min(length, 256)
  const fh = await fsp.open(filePath, 'r')
  let prefix
  try {
    prefix = Buffer.alloc(prefixLength)
    await fh.read(prefix, 0, prefixLength, start)
  } finally { await fh.close() }

  const hash = crypto.createHash('sha256')
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath, { start, end: start + length - 1 })
    stream.on('data', chunk => hash.update(chunk))
    stream.on('end', resolve)
    stream.on('error', reject)
  })
  const printable = [...prefix].filter(byte => byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte <= 126)).length
  const printableRatio = prefix.length ? printable / prefix.length : 0
  return {
    sha256: hash.digest('hex'),
    prefixHex: prefix.toString('hex'),
    prefixAscii: [...prefix].map(byte => byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : '.').join(''),
    printableRatio,
    encodingHint: printableRatio >= 0.9 ? 'mostly_printable_or_base64' : 'binary_or_encrypted'
  }
}

async function inspectImage(filePath, ext) {
  const prefix = await readPrefix(filePath)
  const dim = ext === '.png' ? pngDimensions(prefix) : (ext === '.jpg' || ext === '.jpeg') ? jpegDimensions(prefix) : undefined
  const ascii = prefix.toString('latin1')
  const markers = {
    hasExifApp1: prefix.includes(Buffer.from('Exif\0\0', 'binary')),
    hasAdobeXmp: ascii.includes('http://ns.adobe.com/xap/1.0/'),
    hasGoogleMotionXmp: ascii.includes('http://ns.google.com/photos/1.0/camera/') || ascii.includes('Camera:MotionPhoto'),
    hasNikkiGalleryXmp: ascii.includes('http://wxnn.qianlu.com/xmp/1.0/') || ascii.includes('wxnn:EditorData')
  }
  const jpegTail = (ext === '.jpg' || ext === '.jpeg') ? await scanJpegEoi(filePath) : undefined
  return { ...dim, markers, jpegTail }
}

async function inspectBinary(filePath) {
  const prefix = await readPrefix(filePath, 256)
  const printable = [...prefix].filter(byte => byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte <= 126)).length
  return {
    prefixHex: prefix.toString('hex'),
    prefixAscii: [...prefix].map(byte => byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : '.').join(''),
    printableRatio: prefix.length ? printable / prefix.length : 0
  }
}

function parseRate(value) {
  if (!value || typeof value !== 'string') return undefined
  const [a,b] = value.split('/').map(Number)
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return undefined
  return a / b
}

async function probeVideo(filePath, ffprobe) {
  try {
    const { stdout } = await execFileAsync(ffprobe, [
      '-v','error','-print_format','json','-show_format','-show_streams',filePath
    ], { maxBuffer: 8 * 1024 * 1024 })
    const data = JSON.parse(stdout)
    const video = data.streams?.find(s => s.codec_type === 'video')
    const audio = data.streams?.find(s => s.codec_type === 'audio')
    const creationTime = video?.tags?.creation_time ?? data.format?.tags?.creation_time
    return {
      probeStatus: 'ok',
      width: video?.width,
      height: video?.height,
      durationMs: Number.isFinite(Number(data.format?.duration)) ? Math.round(Number(data.format.duration) * 1000) : undefined,
      codec: video?.codec_name,
      profile: video?.profile,
      pixelFormat: video?.pix_fmt,
      frameRate: parseRate(video?.avg_frame_rate),
      frameCount: Number.isFinite(Number(video?.nb_frames)) ? Number(video.nb_frames) : undefined,
      container: data.format?.format_name,
      hasAudio: Boolean(audio),
      audioCodec: audio?.codec_name,
      creationTime
    }
  } catch (e) {
    return { probeStatus: 'failed', probeError: e.message }
  }
}

function buildPairCandidates(records) {
  const resolver = new AssetResolver()
  const stills = records.filter(r => r.kind === 'image' && ['high_quality_photo','image_other','screenshot','motion_or_video'].includes(r.pathClass))
  const motions = records.filter(r => r.kind === 'video')
  return stills.map(still => {
    const candidates = resolver.resolveMotionCandidates(
      [{
        resourceId: still.path,
        fileName: still.fileName,
        sourcePath: still.path,
        role: still.pathClass === 'high_quality_photo' ? 'source_high_quality' : 'source_primary',
        uid: still.uid,
        modifiedAt: still.modifiedAt,
        birthTime: still.birthTime,
        width: still.width,
        height: still.height
      }],
      motions.map(motion => ({
        resourceId: motion.path,
        fileName: motion.fileName,
        sourcePath: motion.path,
        role: 'source_motion',
        uid: motion.uid,
        modifiedAt: motion.modifiedAt,
        birthTime: motion.birthTime,
        creationTime: motion.video?.creationTime,
        width: motion.width,
        height: motion.height,
        durationMs: motion.video?.durationMs
      }))
    )
      .slice(0, 5)
      .map(candidate => {
        const motion = motions.find(item => item.path === candidate.motionResourceId)
        return {
          motionPath: candidate.motionResourceId,
          motionFileName: motion?.fileName ?? path.basename(candidate.motionResourceId),
          score: candidate.score,
          confidence: candidate.confidence,
          method: candidate.method,
          reasons: candidate.reasons
        }
      })
    return { stillPath: still.path, stillFileName: still.fileName, candidates }
  }).filter(x => x.candidates.length)
}

function buildQualityPairs(records) {
  const resolver = new AssetResolver()
  const inputs = records
    .filter(record => record.pathClass === 'high_quality_photo' || record.pathClass === 'low_quality_photo')
    .map(record => ({
      resourceId: record.path,
      fileName: record.fileName,
      sourcePath: record.path,
      role: record.pathClass === 'high_quality_photo' ? 'source_high_quality' : 'source_low_quality',
      uid: record.uid,
      modifiedAt: record.modifiedAt,
      birthTime: record.birthTime,
      width: record.width,
      height: record.height
    }))
  return resolver.resolvePhotoResources(inputs).flatMap(group => {
    const high = group.resources.find(resource => resource.role === 'source_high_quality')
    const lows = group.resources.filter(resource => resource.role === 'source_low_quality')
    if (!high || lows.length === 0) return []
    return [{
      highPath: high.resourceId,
      matches: lows.map(low => ({
        lowPath: low.resourceId,
        score: 180,
        confidence: group.confidence,
        reasons: group.reasons
      }))
    }]
  })
}

function mdEscape(s) { return String(s ?? '').replaceAll('|','\\|').replaceAll('\n',' ') }

function makeMarkdown(report) {
  const lines = []
  lines.push('# NikkiSync M0.16 样本分析报告', '')
  lines.push(`- 生成时间：${report.generatedAt}`)
  lines.push(`- 根目录：${report.roots.map(x => '`'+x+'`').join(', ')}`)
  lines.push(`- 文件数：${report.summary.totalFiles}`)
  lines.push(`- AssetResolver：v${report.resolverVersion}`)
  lines.push(`- 图片：${report.summary.images}；视频：${report.summary.videos}；二进制伴随文件：${report.summary.binaries}`)
  lines.push(`- HighQuality：${report.summary.highQuality}；LowQuality：${report.summary.lowQuality}`)
  lines.push(`- JPEG 含 EOI 后尾数据：${report.summary.jpegWithTrailingData}`, '')
  lines.push('## 文件概览', '')
  lines.push('| 类型 | 路径分类 | UID | 文件 | 尺寸/时长 | SHA-256 | JPEG尾数据 |')
  lines.push('|---|---|---|---|---|---|---|')
  for (const r of report.records) {
    const dims = r.kind === 'video'
      ? `${r.width ?? '?'}×${r.height ?? '?'} / ${r.video?.durationMs ?? '?'}ms`
      : r.kind === 'image' ? `${r.width ?? '?'}×${r.height ?? '?'}` : `${r.sizeBytes} bytes`
    const tail = r.image?.jpegTail?.trailingBytesAfterFirstEoi ?? ''
    lines.push(`| ${r.kind} | ${r.pathClass} | ${r.uid ?? ''} | ${mdEscape(r.fileName)} | ${dims} | \`${r.sha256.slice(0,12)}…\` | ${tail} |`)
  }
  lines.push('', '## 静态图 ↔ 视频候选', '')
  if (!report.motionCandidates.length) lines.push('未找到正分候选。')
  for (const g of report.motionCandidates) {
    lines.push(`### ${g.stillFileName}`, '')
    for (const c of g.candidates) lines.push(`- **${c.score} 分 / ${(c.confidence*100).toFixed(0)}%** → \`${c.motionFileName}\`：${c.reasons.join('；')}`)
    lines.push('')
  }
  lines.push('## HighQuality ↔ LowQuality 候选', '')
  if (!report.qualityCandidates.length) lines.push('未找到候选。')
  for (const g of report.qualityCandidates) {
    lines.push(`- \`${path.basename(g.highPath)}\` → ${g.matches.map(m => `\`${path.basename(m.lowPath)}\`(${m.score})`).join(', ')}`)
  }
  lines.push('', '## M0 判读提示', '')
  lines.push('- 若多个实况样本都出现稳定的文件名/数字 ID 对应，应优先使用确定性 ID，而不是时间启发式。')
  lines.push('- 若 HighQuality JPEG 的 `trailingBytesAfterFirstEoi > 0`，说明 JPEG 图像编码结束后仍有附加数据，下一步应对这段 payload 做结构/解密比对。')
  lines.push('- 若视频 creation_time 与照片 birth/mtime 的差值稳定，可作为 fallback 匹配信号，但不能作为唯一主键。')
  lines.push('- Motion Photo / Live Photo 最终封装不在此工具中完成；本工具只调查游戏原始资产关系。')
  return lines.join('\n')
}

export async function analyzeSamples(args) {
  await fsp.mkdir(args.output, { recursive: true })

  const records = []
  const errors = []
  let count = 0
  for (const root of args.roots) {
    for await (const item of walk(root)) {
      if (item.error) { errors.push(item.error); continue }
      const ext = path.extname(item.file).toLowerCase()
      const kind = IMAGE_EXTS.has(ext) ? 'image' : VIDEO_EXTS.has(ext) ? 'video' : BINARY_EXTS.has(ext) ? 'binary' : undefined
      if (!kind) continue
      if (++count > args.maxFiles) throw new Error(`max file limit exceeded (${args.maxFiles})`)
      const stat = await fsp.stat(item.file)
      const base = {
        path: path.resolve(item.file), fileName: path.basename(item.file), ext, mimeType: mimeFromExt(ext), kind,
        pathClass: classifyPath(item.file), uid: inferUid(item.file), sizeBytes: stat.size,
        modifiedAt: stat.mtime.toISOString(), birthTime: stat.birthtime.toISOString(),
        sha256: await sha256File(item.file)
      }
      try {
        if (kind === 'image') {
          const image = await inspectImage(item.file, ext)
          records.push({ ...base, width: image.width, height: image.height, image })
        } else if (kind === 'video') {
          const video = await probeVideo(item.file, args.ffprobe)
          records.push({ ...base, width: video.width, height: video.height, video })
        } else {
          records.push({ ...base, binary: await inspectBinary(item.file) })
        }
      } catch (e) {
        errors.push(`${item.file}: ${e.message}`)
        records.push(base)
      }
      console.log(`[${count}] ${kind}: ${item.file}`)
    }
  }

  records.sort((a,b) => a.path.localeCompare(b.path))
  const motionCandidates = buildPairCandidates(records)
  const qualityCandidates = buildQualityPairs(records)
  const report = {
    schemaVersion: 2,
    resolverVersion: ASSET_RESOLVER_VERSION,
    generatedAt: new Date().toISOString(),
    roots: args.roots,
    summary: {
      totalFiles: records.length,
      images: records.filter(r => r.kind === 'image').length,
      videos: records.filter(r => r.kind === 'video').length,
      binaries: records.filter(r => r.kind === 'binary').length,
      highQuality: records.filter(r => r.pathClass === 'high_quality_photo').length,
      lowQuality: records.filter(r => r.pathClass === 'low_quality_photo').length,
      jpegWithTrailingData: records.filter(r => (r.image?.jpegTail?.trailingBytesAfterFirstEoi ?? 0) > 0).length,
      exactHighLowPairs: qualityCandidates.length,
      deterministicMotionPairs: motionCandidates.filter(group =>
        group.candidates.some(candidate => candidate.reasons.includes('motion_cover_stem_exact:+140'))
      ).length
    },
    records,
    motionCandidates,
    qualityCandidates,
    errors
  }

  await fsp.writeFile(path.join(args.output, 'analysis-report.json'), JSON.stringify(report, null, 2), 'utf8')
  await fsp.writeFile(path.join(args.output, 'analysis-report.md'), makeMarkdown(report), 'utf8')
  console.log(`\nReport written to: ${args.output}`)
  return report
}

async function main() {
  const args = parseArgs(process.argv)
  if (args.help || !args.roots.length) {
    usage()
    process.exitCode = args.help ? 0 : 2
    return
  }
  await analyzeSamples(args)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => { console.error(e.stack || e); process.exitCode = 1 })
}
