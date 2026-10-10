import type { DatabaseManager } from '@nikkisync/database';
import type { Server } from 'node:net';
export function releaseProtocolRuntime(): void;
export interface GallerySource {
  count: number;
  refresh(): Promise<void>;
  list(offset:number): {total:number;offset:number;items:{id:string;date:string;live?:boolean}[];next:number|null};
  metadata(id:string): {availability:'available'|'partial'|'unavailable';rows:{label:string;value:string}[]};
  preview(id:string): Promise<Uint8Array>;
  original(id:string): Promise<{image:Uint8Array;mime:string}>;
  browse(offset:number,query:Record<string,unknown>): unknown;
  export(id:string,options:{exif:boolean;rotation:number}):Promise<{image:Uint8Array;mime:string;exifApplied:boolean;rotation:number}>;
  motion(id:string):Promise<{image:Uint8Array;mime:'video/mp4'}>;
  live(id:string,options:{exif:boolean;rotation:number}):Promise<{image:Uint8Array;mime:'application/x-livp'}>;
  outfit(id:string,offset:number):unknown;
  icon(id:string,key:string):Promise<{image:Uint8Array;mime:'image/png';source:'item'|'category'}>;
}
export interface GalleryConfig { type: 'NikkiSyncLocalGalleryDownload'|'NikkiSyncLocalGalleryLive'; version: 1; resume?: 1; host: string; port: number; key: string; sessionId: string; expiresAt: string; }
export interface GalleryEvents { authenticated(): void; disconnected(): void; transferred(): void; refreshed?(count:number): void; settled?(): void; }
export function createIndexedPreviewSource(database: DatabaseManager, roots: string[], options: {resize(bytes: Uint8Array): Promise<Uint8Array>;exportLive?(jpeg:Uint8Array,video:Uint8Array,options:{exif:boolean;metadata:unknown;presentationUs?:number}):Promise<{image:Uint8Array;mime:'application/x-livp'}>;rotatePng?(bytes:Uint8Array,rotation:number):Promise<Uint8Array>;loadIcon?(descriptor:{candidates:{url:string;kind:'item'|'category'}[];versionKey:string}):Promise<{image:Uint8Array;mime:'image/png';source:'item'|'category'}>}): Promise<GallerySource>;
export function exportLive(jpeg:Uint8Array,video:Uint8Array,options:{exif:boolean;metadata:unknown;presentationUs?:number;ffmpeg?:string;ffprobe?:string}):Promise<{image:Uint8Array;mime:'application/x-livp'}>;
export function exportJpeg(bytes:Uint8Array,metadata:unknown,options:{exif:boolean;rotation:number}):Buffer;
export function rotatePng(bytes:Uint8Array,rotation:number,script?:string):Promise<Uint8Array>;
export function createGalleryServer(config: GalleryConfig, source: GallerySource, options: {events: GalleryEvents}): {server: Server; stop(): Promise<void>};
