export interface ImageInfo {
  readonly type: "jpeg" | "png";
  readonly width: number;
  readonly height: number;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function readU16(bytes: Uint8Array, at: number): number {
  return ((bytes[at] ?? 0) << 8) | (bytes[at + 1] ?? 0);
}

function readU32(bytes: Uint8Array, at: number): number {
  return readU16(bytes, at) * 65_536 + readU16(bytes, at + 2);
}

// JPEG: walks the marker segments to the first start-of-frame (SOF0–SOF15, except the
// DHT/JPG/DAC markers C4, C8 and CC) and reads its height and width.
function jpegSize(bytes: Uint8Array): ImageInfo | null {
  let at = 2;
  while (at + 9 < bytes.length) {
    if (bytes[at] !== 0xff) {
      return null;
    }
    const marker = bytes[at + 1] ?? 0;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { type: "jpeg", height: readU16(bytes, at + 5), width: readU16(bytes, at + 7) };
    }
    at += 2 + readU16(bytes, at + 2);
  }
  return null;
}

// Checks the magic bytes and reads the pixel size from the header. Anything that isn't a
// well-formed JPEG or PNG header is null.
export function inspectImage(bytes: Uint8Array): ImageInfo | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return jpegSize(bytes);
  }
  if (PNG_SIGNATURE.every((byte, index) => bytes[index] === byte) && bytes.length >= 24) {
    return { type: "png", width: readU32(bytes, 16), height: readU32(bytes, 20) };
  }
  return null;
}
