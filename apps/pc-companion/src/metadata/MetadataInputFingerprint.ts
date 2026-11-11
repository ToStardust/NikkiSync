import { createHash } from 'node:crypto'

export function inputFingerprint(uid: string, token: string, payload?: string, nuan5Md5?: string): string {
  return createHash('sha256').update(`${uid}\n${token}\n${payload ?? ''}\n${nuan5Md5 ?? ''}`, 'utf8').digest('hex')
}
