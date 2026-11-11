// Presentation of existing canonical metadata only. No resolver, dictionary fetch or raw payload export.
const CAMERA_FIELDS = [
  ['焦距', 'focalLength'], ['镜头旋转', 'rotation'], ['光圈', 'apertureSection', 'aperture'],
  ['景深', 'depthOfField'], ['晕影', 'vignetteIntensity', 'vignette'],
  ['柔光', 'bloomIntensity', 'softLightStrength'], ['柔光范围', 'bloomThreshold', 'softLightRange'],
  ['亮度', 'brightness'], ['曝光', 'exposure'], ['对比度', 'contrast'], ['饱和度', 'saturation'],
  ['自然饱和', 'vibrance'], ['高光', 'highlights'], ['阴影', 'shadows']
];

function displayText(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? String(Number(value.toPrecision(6))) : '';
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim() : '';
}

function effectText(effect) {
  const name = displayText(effect?.name) || displayText(effect?.displayName);
  const strength = displayText(effect?.strength);
  return strength && Number.isFinite(Number(strength))
    ? [name, strength + '%'].filter(Boolean).join(' · ')
    : name;
}

export function displayedPose(metadata) {
  return effectText(metadata?.pose) ? metadata.pose : metadata?.action;
}

export function playerMetadata(metadata, fullShare = false) {
  const rows = [], add = (label, value) => {
    const text = displayText(value);
    if (!text) return false;
    rows.push({ label, value: text.slice(0, 160) });
    return true;
  };
  if (!metadata || typeof metadata !== 'object') return { availability: 'unavailable', rows };
  add('游戏版本', metadata.identity?.gameVersion);
  for (const [label, ...keys] of CAMERA_FIELDS) keys.some(key => add(label, metadata.camera?.[key]));
  add('动作', effectText(displayedPose(metadata)));
  add('滤镜', effectText(metadata.filter));
  add('光照', effectText(metadata.lighting));
  add('地点', metadata.location?.name);
  const clothes = Array.isArray(metadata.dressing?.clothes) ? metadata.dressing.clothes : [];
  const names = clothes.map(x => x && typeof x === 'object' ? x.name : undefined).filter(x => typeof x === 'string' && x.trim());
  if (names.length) add('服装', names.join('、'));
  const unknown = clothes.length - names.length;
  if (unknown) add('服装名称', unknown + ' 件尚未解析');
  const result = { availability: unknown ? 'partial' : rows.length ? 'available' : 'unavailable', rows };
  return fullShare ? result : boundedPlayerMetadata(result);
}

export function boundedPlayerMetadata(result) {
  const rows = result.rows.slice(0, 16);
  // The original control message is bounded and validated by already installed Mini clients.
  const wireLength = () => JSON.stringify({kind:'metadata',req:256,id:'a'.repeat(32),availability:result.availability,rows}).replace(/[^\x20-\x7e]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0')).length;
  while (rows.length && wireLength() > 3500) rows.pop();
  return { ...result, rows };
}
