// Presentation of existing canonical metadata only. No resolver, dictionary fetch or raw payload export.
export function playerMetadata(metadata) {
  const rows = [], add = (label, value) => {
    if (typeof value === 'number') value = Number.isFinite(value) ? String(Number(value.toPrecision(6))) : '';
    if (typeof value !== 'string' || !value.trim()) return;
    rows.push({ label, value: value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 160) });
  };
  if (!metadata || typeof metadata !== 'object') return { availability: 'unavailable', rows };
  add('游戏版本', metadata.identity?.gameVersion);
  for (const [key, label] of [['focalLength','焦距'],['apertureSection','光圈'],['exposure','曝光'],['brightness','亮度'],['contrast','对比度'],['saturation','饱和度'],['bloomIntensity','柔光']]) add(label, metadata.camera?.[key]);
  add('滤镜',metadata.filter?.name); add('光照',metadata.lighting?.name); add('地点',metadata.location?.name);
  const clothes = Array.isArray(metadata.dressing?.clothes) ? metadata.dressing.clothes : [];
  const names = clothes.map(x => x && typeof x === 'object' ? x.name : undefined).filter(x => typeof x === 'string' && x.trim());
  if (names.length) add('服装', names.join('、'));
  const unknown = clothes.length - names.length;
  if (unknown) add('服装名称', unknown + ' 件尚未解析');
  // ASCII-escaped JSON is the bounded wire format; avoid truncating a JSON record mid-string.
  const wireLength = () => JSON.stringify({kind:'metadata',req:256,id:'a'.repeat(32),availability:'available',rows}).replace(/[^\x20-\x7e]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0')).length;
  while (rows.length && wireLength() > 3500) rows.pop();
  return { availability: unknown ? 'partial' : rows.length ? 'available' : 'unavailable', rows };
}
