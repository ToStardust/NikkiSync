import {createHash} from 'node:crypto'

/** Physical media identity only. Dressing, calendar inference and decoded metadata do not invalidate it. */
export function mediaFingerprint(rows:Record<string,unknown>[]):string|undefined {
  const sources=rows.filter(row=>String(row.role).startsWith('source_')&&String(row.stable_state??'stable')==='stable')
  if(!sources.length||sources.some(row=>!/^[a-f0-9]{64}$/i.test(String(row.sha256))||!Number.isSafeInteger(Number(row.size_bytes))||Number(row.size_bytes)<0))return undefined
  const identity=sources.map(row=>[String(row.resource_id),String(row.role),String(row.path_key??''),String(row.sha256).toLowerCase(),Number(row.size_bytes)])
    .sort((a,b)=>String(a[0]).localeCompare(String(b[0])))
  return createHash('sha256').update(JSON.stringify(identity)).digest('hex')
}
