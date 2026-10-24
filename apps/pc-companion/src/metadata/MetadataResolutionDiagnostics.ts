import type { DatabaseManager } from '@nikkisync/database'

/** Support report: aggregate counters only. Never serialize rows, native tuples or raw error text. */
export function metadataResolutionDiagnostics(database: Pick<DatabaseManager, 'connection'>, resolverEnabled: boolean) {
  const entries = `WITH entries AS (
    SELECT asset_type, uid, CASE WHEN json_valid(metadata_json) THEN metadata_json ELSE '{}' END AS metadata
    FROM assets WHERE asset_state <> 'deleted'
  ), photos AS (
    SELECT *, (COALESCE(uid, '') <> '' AND COALESCE(json_extract(metadata, '$.raw.nativeParamToken'), '') <> '') AS eligible
    FROM entries WHERE asset_type = 'photo'
  )`
  const counts = database.connection.prepare(`${entries}
    SELECT COUNT(*) AS ordinaryPhotos,
      COALESCE(SUM(eligible), 0) AS withNativeToken,
      COALESCE(SUM(eligible AND COALESCE(json_extract(metadata, '$.raw.nativeParamPayload'), '') <> ''
        AND COALESCE(json_extract(metadata, '$.raw.nativeParamNuan5Md5'), '') <> ''), 0) AS withCompleteEnvelope,
      COALESCE(SUM(eligible AND json_extract(metadata, '$.raw.resolver.status') = 'resolved'), 0) AS resolved,
      COALESCE(SUM(eligible AND json_extract(metadata, '$.raw.resolver.status') = 'failed'), 0) AS failed,
      COALESCE(SUM(json_type(metadata, '$.dressing.clothes') = 'array'
        AND json_array_length(metadata, '$.dressing.clothes') > 0), 0) AS withOutfit,
      COALESCE(SUM(json_type(metadata, '$.camera') = 'object' AND json_extract(metadata, '$.camera') <> '{}'), 0) AS withCamera,
      (SELECT COUNT(*) FROM entries WHERE asset_type = 'motion_photo') AS motionPhotos
    FROM photos`).get() as Record<string, number>
  const failures = database.connection.prepare(`${entries}
    SELECT CASE
      WHEN json_extract(metadata, '$.raw.resolver.error') LIKE '%fetch failed%'
        OR json_extract(metadata, '$.raw.resolver.error') LIKE '%abort%'
        OR json_extract(metadata, '$.raw.resolver.error') LIKE '%timed out%'
        OR json_extract(metadata, '$.raw.resolver.error') LIKE '%ENOTFOUND%' THEN 'networkOrTimeout'
      WHEN json_extract(metadata, '$.raw.resolver.error') LIKE '%resolver HTTP%' THEN 'http'
      WHEN json_extract(metadata, '$.raw.resolver.error') LIKE '%rejected photo%' THEN 'sourceRejected'
      WHEN json_extract(metadata, '$.raw.resolver.error') LIKE '%requires a native payload%'
        OR json_extract(metadata, '$.raw.resolver.error') LIKE '%JPEG-prefix MD5 is invalid%'
        OR json_extract(metadata, '$.raw.resolver.error') LIKE '%embedded segments are invalid%' THEN 'incompleteEnvelope'
      WHEN json_extract(metadata, '$.raw.resolver.error') LIKE '%unexpected%response%'
        OR json_extract(metadata, '$.raw.resolver.error') LIKE '%invalid decoded photo%' THEN 'invalidResponse'
      ELSE 'other' END AS category, COUNT(*) AS count
    FROM photos WHERE eligible AND json_extract(metadata, '$.raw.resolver.status') = 'failed'
    GROUP BY category`).all() as Array<{ category: string; count: number }>
  return {
    schemaVersion: 1, generatedAt: new Date().toISOString(), resolverEnabled,
    ordinaryPhotos: Number(counts.ordinaryPhotos), withNativeToken: Number(counts.withNativeToken),
    withCompleteEnvelope: Number(counts.withCompleteEnvelope), resolved: Number(counts.resolved),
    failed: Number(counts.failed), pending: Math.max(0, Number(counts.withNativeToken) - Number(counts.resolved) - Number(counts.failed)),
    withOutfit: Number(counts.withOutfit), withCamera: Number(counts.withCamera), motionPhotos: Number(counts.motionPhotos),
    failureCategories: Object.fromEntries(failures.map(row => [row.category, Number(row.count)]))
  }
}
