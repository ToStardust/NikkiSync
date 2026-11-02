import path from 'node:path'

/** Recognized photo layouts, not an inference from arbitrary numeric backup folders. */
export function gamePlayUid(filePath:string):string|undefined {
  const parts=path.resolve(filePath).split(path.sep)
  for(let i=parts.length-3;i>=0;i--)if(/^GamePlayPhotos$/i.test(parts[i]!)&&/^\d{5,}$/.test(parts[i+1]!))return parts[i+1]
  return undefined
}

export function nativePhotoLayout(filePath:string):{kind:'high_quality'|'low_quality';groupDirectory:string;supplemental:boolean}|undefined {
  const directory=path.dirname(filePath),name=path.basename(directory),parent=path.dirname(directory)
  if(/^NikkiPhotos_(High|Low)Quality$/i.test(name))return {kind:/_HighQuality$/i.test(name)?'high_quality':'low_quality',groupDirectory:parent,supplemental:false}
  if(/^CloudPhotos(?:_LowQuality)?$/i.test(name))return {kind:/_LowQuality$/i.test(name)?'low_quality':'high_quality',groupDirectory:path.join(parent,'CloudPhotos'),supplemental:true}
  if(/^(MagazinePhotos|ClockInPhoto)$/i.test(name))return {kind:'high_quality',groupDirectory:directory,supplemental:true}
  if(/^Collage$/i.test(path.basename(parent))&&/^(HighQuality|LowQuality|CollagePhoto)$/i.test(name))return {
    kind:/^LowQuality$/i.test(name)?'low_quality':'high_quality',groupDirectory:/^CollagePhoto$/i.test(name)?directory:parent,supplemental:true
  }
  if(/^\d{5,}$/.test(name)&&/^GamePlayPhotos$/i.test(path.basename(parent)))return {kind:'high_quality',groupDirectory:directory,supplemental:true}
  return undefined
}

/** Account location retained by a moved UID/category subtree, never a plain dated screenshot folder. */
export function nativePhotoAccountDirectory(filePath:string):string|undefined {
  const directory=path.dirname(filePath),name=path.basename(directory),parent=path.dirname(directory)
  if(!nativePhotoLayout(filePath))return undefined
  if(/^\d{5,}$/.test(name)&&/^GamePlayPhotos$/i.test(path.basename(parent)))return directory
  const account=/^Collage$/i.test(path.basename(parent))?path.dirname(parent):parent
  return /^\d{5,}$/.test(path.basename(account))?account:undefined
}

export function isNativePhotoSource(filePath:string):boolean {
  return /\.(jpe?g|png|webp)$/i.test(filePath)&&nativePhotoLayout(filePath)?.kind==='high_quality'
}
