import path from 'node:path'

/** Preserve original paths separately; use this key only for canonical comparison. */
export function toPathKey(input: string, platform: NodeJS.Platform = process.platform): string {
  let result = path.resolve(input).replaceAll('\\', '/').replace(/\/+$/, '')
  if (platform === 'win32') result = result.toLowerCase()
  return result
}
