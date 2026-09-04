import path from 'node:path'
import type { AssetResolverCandidate, ResourceId, ResourceRole } from './types.js'

export interface ResolverResourceInput {
  resourceId: ResourceId
  fileName: string
  sourcePath?: string
  role?: ResourceRole
  uid?: string
  modifiedAt?: string
  birthTime?: string
  creationTime?: string
  width?: number
  height?: number
  durationMs?: number
}

export interface ResolvedPhotoResources {
  key: string
  uid?: string
  stem: string
  primaryResourceId: ResourceId
  confidence: number
  reasons: string[]
  resources: ResolverResourceInput[]
}

export const ASSET_RESOLVER_VERSION = 1 as const

function normalizeStem(name: string): string {
  return path.basename(name, path.extname(name)).toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function numericTokens(name: string): Set<string> {
  return new Set(path.basename(name).match(/\d{4,}/g) ?? [])
}

function motionCoverStem(name: string): string {
  const stem = path.basename(name, path.extname(name)).replace(/_cover$/i, '')
  return stem.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function rolePriority(role: ResourceRole | undefined): number {
  if (role === 'source_high_quality') return 0
  if (role === 'source_primary') return 1
  if (role === 'source_low_quality') return 2
  return 3
}

function timeMs(resource: ResolverResourceInput): number | undefined {
  for (const candidate of [resource.creationTime, resource.birthTime, resource.modifiedAt]) {
    if (!candidate) continue
    const parsed = Date.parse(candidate)
    if (Number.isFinite(parsed) && parsed > Date.parse('2000-01-01')) return parsed
  }
  return undefined
}

export class AssetResolver {
  resolvePhotoResources(resources: readonly ResolverResourceInput[]): ResolvedPhotoResources[] {
    const groups = new Map<string, ResolverResourceInput[]>()
    for (const resource of resources) {
      const key = `${resource.uid ?? ''}:${normalizeStem(resource.fileName)}`
      const group = groups.get(key) ?? []
      group.push(resource)
      groups.set(key, group)
    }
    return [...groups.entries()]
      .map(([key, grouped]) => {
        const ordered = [...grouped].sort((a, b) =>
          rolePriority(a.role) - rolePriority(b.role) || a.resourceId.localeCompare(b.resourceId)
        )
        const roles = new Set(ordered.map((resource) => resource.role))
        const exactQualityPair = roles.has('source_high_quality') && roles.has('source_low_quality')
        const first = ordered[0]
        if (!first) throw new Error(`Resolver produced an empty group: ${key}`)
        const resolved: ResolvedPhotoResources = {
          key,
          stem: normalizeStem(first.fileName),
          primaryResourceId: first.resourceId,
          confidence: exactQualityPair ? 1 : 0.5,
          reasons: exactQualityPair
            ? ['uid_and_stem_exact', 'high_low_roles_present']
            : ['single_quality_variant'],
          resources: ordered
        }
        if (first.uid !== undefined) resolved.uid = first.uid
        return resolved
      })
      .sort((a, b) => a.key.localeCompare(b.key))
  }

  resolveMotionCandidates(
    stills: readonly ResolverResourceInput[],
    motions: readonly ResolverResourceInput[]
  ): AssetResolverCandidate[] {
    return stills.flatMap((still) => motions.map((motion) => this.scoreCandidate(still, motion)))
      .filter((candidate) => candidate.score > 0)
      .sort((a, b) =>
        b.score - a.score ||
        a.stillResourceId.localeCompare(b.stillResourceId) ||
        a.motionResourceId.localeCompare(b.motionResourceId)
      )
  }

  scoreCandidate(still: ResolverResourceInput, motion: ResolverResourceInput): AssetResolverCandidate {
    let score = 0
    const reasons: string[] = []
    const stillStem = normalizeStem(still.fileName)
    const motionStem = normalizeStem(motion.fileName)
    const exactMotionBundle = motionCoverStem(still.fileName) === motionStem && /_cover\.[^.]+$/i.test(still.fileName)
    let hardRejected = false
    let hasPairSignal = false

    if (exactMotionBundle) {
      hasPairSignal = true
      score += 140
      reasons.push('motion_cover_stem_exact:+140')
      if (still.sourcePath && motion.sourcePath && path.dirname(still.sourcePath).toLowerCase() === path.dirname(motion.sourcePath).toLowerCase()) {
        score += 30
        reasons.push('same_parent_directory:+30')
      }
    } else if (stillStem === motionStem) {
      hasPairSignal = true
      score += 90
      reasons.push('basename_exact:+90')
    } else if (stillStem && motionStem && (stillStem.includes(motionStem) || motionStem.includes(stillStem))) {
      hasPairSignal = true
      score += 45
      reasons.push('basename_contains:+45')
    }

    const commonNumbers = [...numericTokens(still.fileName)].filter((token) => numericTokens(motion.fileName).has(token))
    if (commonNumbers.length > 0) {
      hasPairSignal = true
      score += 35
      reasons.push(`numeric_token:${commonNumbers.join(',')}:+35`)
    }

    if (still.uid && motion.uid) {
      if (still.uid === motion.uid) {
        score += 25
        reasons.push('uid_equal:+25')
      } else {
        hardRejected = true
        reasons.push('uid_different:reject')
      }
    }

    const stillTime = timeMs(still)
    const motionTime = timeMs(motion)
    if (stillTime !== undefined && motionTime !== undefined) {
      const seconds = Math.abs(stillTime - motionTime) / 1000
      if (seconds <= 1) {
        hasPairSignal = true
        score += 50
        reasons.push(`time<=1s:+50(${seconds.toFixed(3)}s)`)
      } else if (seconds <= 3) {
        hasPairSignal = true
        score += 35
        reasons.push(`time<=3s:+35(${seconds.toFixed(3)}s)`)
      } else if (seconds <= 10) {
        hasPairSignal = true
        score += 15
        reasons.push(`time<=10s:+15(${seconds.toFixed(3)}s)`)
      } else if (seconds > 300) {
        if (!exactMotionBundle) {
          hardRejected = true
          reasons.push(`impossible_time_difference:reject(${seconds.toFixed(1)}s)`)
        } else {
          reasons.push(`bundle_write_time_ignored(${seconds.toFixed(1)}s)`)
        }
      } else if (seconds > 30) {
        score -= 40
        reasons.push(`time>30s:-40(${seconds.toFixed(1)}s)`)
      }
    }

    if (still.width && still.height && motion.width && motion.height) {
      const stillRatio = still.width / still.height
      const motionRatio = motion.width / motion.height
      const difference = Math.abs(stillRatio - motionRatio) / Math.max(stillRatio, motionRatio)
      if (difference <= 0.01) {
        score += 20
        reasons.push('aspect_ratio<=1%:+20')
      } else if (difference <= 0.05) {
        score += 10
        reasons.push('aspect_ratio<=5%:+10')
      }
    }

    if (motion.durationMs !== undefined && motion.durationMs <= 10_000) {
      score += 5
      reasons.push('short_video<=10s:+5')
    }

    if (!hasPairSignal) {
      hardRejected = true
      reasons.push('insufficient_pair_signal:reject')
    }
    if (hardRejected) score = -1

    const method = exactMotionBundle || reasons.some((reason) => reason.startsWith('basename_exact'))
      ? 'filename'
      : reasons.some((reason) => reason.startsWith('time<=1s'))
        ? 'timestamp'
        : 'heuristic'

    return {
      stillResourceId: still.resourceId,
      motionResourceId: motion.resourceId,
      score,
      confidence: hardRejected ? 0 : Math.max(0, Math.min(1, score / 180)),
      method,
      reasons
    }
  }
}
