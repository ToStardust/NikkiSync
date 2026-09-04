import { closeSync, mkdirSync, openSync, unlinkSync } from 'node:fs'
import path from 'node:path'

export function chooseWritableDataDirectory(candidates: readonly string[], isWritable: (directory: string) => boolean): string {
  const selected = candidates.find((directory) => isWritable(directory))
  if (!selected) throw new Error('NikkiSync 无法找到可写的数据目录。')
  return selected
}

export function isWritableDataDirectory(directory: string): boolean {
  const probe = path.join(directory, `.nikkisync-write-${process.pid}-${Date.now()}.tmp`)
  try {
    mkdirSync(directory, { recursive: true })
    const descriptor = openSync(probe, 'wx')
    closeSync(descriptor)
    unlinkSync(probe)
    return true
  } catch {
    try { unlinkSync(probe) } catch { /* best effort cleanup */ }
    return false
  }
}
