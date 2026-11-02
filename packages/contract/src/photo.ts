import { z } from "zod";

// Photos for makes: one per quest, cropped to 4:5 (PRD R12), with location
// and device data removed on the phone before upload (R13).

export const MakeStatus = z.enum(["uploaded", "scanning", "blocked", "held_for_review", "reviewing", "reviewed"]);
export type MakeStatus = z.infer<typeof MakeStatus>;

export const PHOTO = {
  aspect: 4 / 5, // width / height
  longEdge: 1600, // pixels; enough for coaching, small enough to upload on 4G
  jpegQuality: 0.82,
  maxBytes: 4_000_000,
} as const;

// A photo taken offline can be saved up to this long after it was taken.
export const MAKE_UPLOAD_WINDOW_HOURS = 48;

// Where a make's photo lives in the private "makes" bucket: one folder per teen.
export function makePath(teenId: string, makeId: string): string {
  return `${teenId}/${makeId}.jpg`;
}

// The largest centred 4:5 rectangle inside a width × height image.
export function cropTo45(width: number, height: number): { originX: number; originY: number; width: number; height: number } {
  if (width <= 0 || height <= 0) throw new Error("image has no size");
  if (width / height > PHOTO.aspect) {
    const w = Math.round(height * PHOTO.aspect);
    return { originX: Math.floor((width - w) / 2), originY: 0, width: w, height };
  }
  const h = Math.min(height, Math.round(width / PHOTO.aspect));
  return { originX: 0, originY: Math.floor((height - h) / 2), width, height: h };
}

// The size to resize a 4:5 crop to, never upscaling.
export function resizeFor(crop: { width: number; height: number }): { width: number; height: number } {
  if (crop.height <= PHOTO.longEdge) return { width: crop.width, height: crop.height };
  return { width: Math.round(PHOTO.longEdge * PHOTO.aspect), height: PHOTO.longEdge };
}

// ---------------------------------------------------------------------------
// JPEG metadata. A JPEG is a list of marker segments; metadata lives in APPn
// and COM segments, separate from the image data, so it can be dropped without
// re-encoding. Kept: JFIF (APP0), the colour profile (APP2 ICC_PROFILE) and
// Adobe's colour flag (APP14), which change how the picture looks. Dropped:
// EXIF and XMP (APP1: GPS, camera, time), IPTC (APP13), every other APPn,
// comments, and anything after the end of the image (extra pictures, gain maps).

export interface JpegMetadataReport {
  exif: boolean;
  gps: boolean;
  xmp: boolean;
  iptc: boolean;
  comment: boolean;
  trailing: boolean; // bytes after the end-of-image marker
}

const SOI = 0xd8;
const EOI = 0xd9;
const SOS = 0xda;
const COM = 0xfe;

const ascii = (b: Uint8Array, start: number, len: number) => String.fromCharCode(...b.subarray(start, Math.min(b.length, start + len)));

function startsWith(b: Uint8Array, at: number, text: string): boolean {
  return ascii(b, at, text.length) === text;
}

interface Segment {
  marker: number;
  start: number; // index of the 0xFF
  end: number; // index after the segment (for SOS: after its header)
  dataStart: number; // after the length field
}

// Walks the file. `onSegment` sees every marker segment; scan data is passed
// to `onScanData` untouched. Returns the index just after EOI.
function walk(b: Uint8Array, onSegment: (s: Segment) => void, onScanData: (start: number, end: number) => void): number {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== SOI) throw new Error("not a JPEG");
  let i = 2;
  let inScan = false;
  while (i < b.length) {
    if (inScan) {
      // Entropy-coded data runs until a marker that isn't stuffing (FF00) or a restart (FFD0–FFD7).
      const start = i;
      while (i < b.length) {
        if (b[i] === 0xff && i + 1 < b.length) {
          const n = b[i + 1]!;
          if (n !== 0x00 && !(n >= 0xd0 && n <= 0xd7) && n !== 0xff) break;
        }
        i++;
      }
      onScanData(start, i);
      inScan = false;
      continue;
    }
    if (b[i] !== 0xff) throw new Error(`bad JPEG: expected a marker at byte ${i}`);
    while (b[i + 1] === 0xff) i++; // fill bytes
    const marker = b[i + 1];
    if (marker === undefined) throw new Error("bad JPEG: cut off");
    if (marker === EOI) return i + 2;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      onSegment({ marker, start: i, end: i + 2, dataStart: i + 2 });
      i += 2;
      continue;
    }
    if (i + 3 >= b.length) throw new Error("bad JPEG: cut off");
    const len = (b[i + 2]! << 8) | b[i + 3]!;
    const end = i + 2 + len;
    if (len < 2 || end > b.length) throw new Error("bad JPEG: segment runs past the end");
    onSegment({ marker, start: i, end, dataStart: i + 4 });
    i = end;
    if (marker === SOS) inScan = true;
  }
  throw new Error("bad JPEG: no end-of-image marker");
}

// GPSInfo (tag 0x8825) in the first image directory of an EXIF block.
function exifHasGps(b: Uint8Array, tiff: number, end: number): boolean {
  if (tiff + 8 > end) return false;
  const little = b[tiff] === 0x49; // "II"
  const u16 = (at: number) => (little ? b[at]! | (b[at + 1]! << 8) : (b[at]! << 8) | b[at + 1]!);
  const u32 = (at: number) => (little ? (b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16)) + b[at + 3]! * 2 ** 24 : b[at]! * 2 ** 24 + ((b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!));
  const ifd = tiff + u32(tiff + 4);
  if (ifd + 2 > end) return false;
  const count = u16(ifd);
  for (let k = 0; k < count; k++) {
    const entry = ifd + 2 + k * 12;
    if (entry + 12 > end) break;
    if (u16(entry) === 0x8825) return true;
  }
  return false;
}

export function jpegMetadata(bytes: Uint8Array): JpegMetadataReport {
  const r: JpegMetadataReport = { exif: false, gps: false, xmp: false, iptc: false, comment: false, trailing: false };
  const endOfImage = walk(
    bytes,
    (s) => {
      if (s.marker === 0xe1 && startsWith(bytes, s.dataStart, "Exif\0\0")) {
        r.exif = true;
        if (exifHasGps(bytes, s.dataStart + 6, s.end)) r.gps = true;
      } else if (s.marker === 0xe1 && startsWith(bytes, s.dataStart, "http://ns.adobe.com/xap/1.0/")) {
        r.xmp = true;
        if (/GPS(Latitude|Longitude)/.test(ascii(bytes, s.dataStart, s.end - s.dataStart))) r.gps = true;
      } else if (s.marker === 0xed) {
        r.iptc = true;
      } else if (s.marker === COM) {
        r.comment = true;
      }
    },
    () => undefined,
  );
  r.trailing = endOfImage < bytes.length;
  return r;
}

function keep(bytes: Uint8Array, s: Segment): boolean {
  if (s.marker === 0xe0) return true; // JFIF
  if (s.marker === 0xe2) return startsWith(bytes, s.dataStart, "ICC_PROFILE\0");
  if (s.marker === 0xee) return startsWith(bytes, s.dataStart, "Adobe");
  if (s.marker >= 0xe1 && s.marker <= 0xef) return false;
  return s.marker !== COM;
}

// The same picture with every metadata segment removed. Throws on anything
// that isn't a well-formed JPEG, so a broken file is never uploaded.
export function stripJpegMetadata(bytes: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [bytes.subarray(0, 2)];
  walk(
    bytes,
    (s) => {
      if (keep(bytes, s)) parts.push(bytes.subarray(s.start, s.end));
    },
    (start, end) => parts.push(bytes.subarray(start, end)),
  );
  parts.push(new Uint8Array([0xff, EOI]));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export function hasPrivateMetadata(r: JpegMetadataReport): boolean {
  return r.exif || r.gps || r.xmp || r.iptc || r.comment || r.trailing;
}
