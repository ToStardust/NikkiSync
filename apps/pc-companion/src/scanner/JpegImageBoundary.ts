import {open} from 'node:fs/promises'

/** Walk JPEG segments and entropy-coded scans; embedded EXIF thumbnails cannot end the image. */
export async function jpegImageLength(file:string,size:number):Promise<number|undefined>{
  const handle=await open(file,'r')
  const small=Buffer.alloc(2),chunk=Buffer.alloc(64*1024)
  const word=async(offset:number)=>{if(offset<0||offset+2>size)return -1;const result=await handle.read(small,0,2,offset);return result.bytesRead===2?small.readUInt16BE():-1}
  try{
    if(await word(0)!==0xffd8)return undefined
    let offset=2
    for(let segments=0;segments<65536&&offset<size;segments++){
      let marker=await word(offset)
      let padding=0
      while(marker===0xffff){if(++padding>65536)return undefined;offset++;marker=await word(offset)}
      if((marker&0xff00)!==0xff00||marker<0)return undefined
      const code=marker&255;offset+=2
      if(code===0xd9)return offset
      if(code===0xd8||code===0)return undefined
      if(code===1||(code>=0xd0&&code<=0xd7))continue
      const length=await word(offset)
      if(length<2||offset+length>size)return undefined
      offset+=length
      if(code!==0xda)continue
      let ff=-1,next=-1
      while(offset<size&&next<0){
        const {bytesRead}=await handle.read(chunk,0,Math.min(chunk.length,size-offset),offset)
        if(bytesRead===0)return undefined
        for(let i=0;i<bytesRead;i++){
          const value=chunk[i]!
          if(ff>=0){
            if(value===255){ff=offset+i;continue}
            if(value===0||(value>=0xd0&&value<=0xd7)){ff=-1;continue}
            next=ff;break
          }
          if(value===255)ff=offset+i
        }
        offset+=bytesRead
      }
      if(next<0)return undefined
      offset=next
    }
    return undefined
  }finally{await handle.close()}
}
