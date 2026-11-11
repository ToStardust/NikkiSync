import type { DatabaseManager, SyncReadRepository } from '@nikkisync/database';
import type { Server } from 'node:net';
import type { LocalClothingIconPack } from '../metadata/LocalClothingIconPack.js';
export function releaseProtocolRuntime(): void;
export function setRemoteGameVersionReleases(releases: readonly {version:string;effectiveAt:string;uncertainFrom?:string}[]): void;
export interface GallerySource {
  deletionTarget?(id:string): {assetId:string;revision:number;mediaFingerprint?:string};
  deletion?(action:string,input:Record<string,unknown>):Promise<unknown>;
  deletionConnected?():void;
  deletionDisconnected?():Promise<void>;
  inspiration?(action:string,input:Record<string,unknown>):Promise<unknown>;
  inspirationImage?(id:string,key:string,preview?:boolean):Promise<{image:Uint8Array;mime:string}>;
  inspirationUpload?(meta:Record<string,unknown>,bytes:Uint8Array):Promise<unknown>;
  count: number;
  galleryItemLimit?: number;
  refresh(): Promise<void>;
  refreshIfIndexChanged?(): Promise<boolean>;
  previewCacheKeys?(ids:string[]): (string|null)[];
  cachedDetails?(id:string,version?:string): unknown;
  shareDetails?(id:string,includeFilter?:boolean): unknown;
  list(offset:number,limit?:number): {total:number;offset:number;items:{id:string;date:string;live?:boolean}[];next:number|null};
  metadata(id:string): {availability:'available'|'partial'|'unavailable';rows:{label:string;value:string}[]};
  preview(id:string): Promise<Uint8Array>;
  original(id:string): Promise<{image:Uint8Array;mime:string}>;
  browse(offset:number,query:Record<string,unknown>,limit?:number): unknown;
  export(id:string,options:{exif:boolean;rotation:number}):Promise<{image:Uint8Array;mime:string;exifApplied:boolean;rotation:number}>;
  motionRotation?: boolean;
  motion(id:string,rotation?:number):Promise<{image:Uint8Array;mime:'video/mp4'}>;
  live(id:string,options:{exif:boolean;rotation:number}):Promise<{image:Uint8Array;mime:'application/x-livp'}>;
  outfit(id:string,offset:number,cacheKeys?:boolean):unknown;
  icon(id:string,key:string):Promise<{image:Uint8Array;mime:'image/png';source:'item'|'category'}>;
}
export interface GalleryConfig { type: 'NikkiSyncLocalGalleryDownload'|'NikkiSyncLocalGalleryLive'; version: 1; resume?: 1; deletion?:1; host: string; hosts?: string[]; port: number; key: string; sessionId: string; expiresAt: string; }
export interface GalleryEvents { authenticated(): void; disconnected(): void; transferred(): void; refreshed?(count:number): void; settled?(): void; expiryChanged?(expiresAt:string): void; }
export function createIndexedPreviewSource(database: DatabaseManager, roots: string[], options: {
  reads?: SyncReadRepository;
  exportCopies?(): ReadonlyMap<string, string>;
  cacheSecret?: string;
  resize(bytes: Uint8Array): Promise<Uint8Array>;
  motionFfmpeg?: string;
  exportLive?(jpeg: Uint8Array, video: Uint8Array, options: {exif:boolean;metadata:unknown;presentationUs?:number}): Promise<{image:Uint8Array;mime:'application/x-livp'}>;
  rotatePng?(bytes: Uint8Array, rotation: number): Promise<Uint8Array>;
  localClothingIcons?: LocalClothingIconPack;
  convertLocalWebp?(bytes: Uint8Array): Promise<Uint8Array>;
  loadIcon?(descriptor: {candidates:{url:string;kind:'item'|'category'}[];versionKey:string}): Promise<{image:Uint8Array;mime:'image/png';source:'item'|'category'}>;
}): Promise<GallerySource>;
export function exportLive(jpeg:Uint8Array,video:Uint8Array,options:{exif:boolean;metadata:unknown;presentationUs?:number;ffmpeg?:string;ffprobe?:string}):Promise<{image:Uint8Array;mime:'application/x-livp'}>;
export function exportJpeg(bytes:Uint8Array,metadata:unknown,options:{exif:boolean;rotation:number;cameraName?:string|undefined}):Buffer;
export function gameVersionEnglishName(version:unknown):string|undefined;
export function setRemoteGameVersionNames(names:Record<string,string>):void;
export function rotatePng(bytes:Uint8Array,rotation:number,script?:string):Promise<Uint8Array>;
export function createGalleryServer(config: GalleryConfig, source: GallerySource, options: {events: GalleryEvents;allowLivePackaging?:boolean}): {server: Server; stop(): Promise<void>};
