const MAX_DIMENSION = 2048;
const JPEG_QUALITY = 0.85;

const HEIC_TYPES = ['image/heic', 'image/heif'];

function isHeicFile(file: File): boolean {
  if (HEIC_TYPES.includes(file.type)) return true;
  return /\.hei[cf]$/i.test(file.name);
}

/** Resize + draw to canvas → JPEG data URL. */
function drawToJpeg(source: HTMLImageElement | ImageBitmap): string {
  let w = source instanceof HTMLImageElement ? source.naturalWidth : source.width;
  let h = source instanceof HTMLImageElement ? source.naturalHeight : source.height;

  if (w > MAX_DIMENSION || h > MAX_DIMENSION) {
    if (w >= h) {
      h = Math.round(h * (MAX_DIMENSION / w));
      w = MAX_DIMENSION;
    } else {
      w = Math.round(w * (MAX_DIMENSION / h));
      h = MAX_DIMENSION;
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;

  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(source, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', JPEG_QUALITY);
}

/** Load a blob via native Image element (JPEG/PNG/WebP + HEIC on Safari). */
function loadNative(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Native decode failed'));
    };
    img.src = url;
  });
}

/** Convert HEIC → ImageBitmap via heic-to (lazy-loaded, libheif WASM). */
async function decodeHeic(file: File): Promise<ImageBitmap> {
  const { heicTo } = await import('heic-to');
  return heicTo({ blob: file, type: 'bitmap' });
}

/**
 * Normalize an image file to a JPEG data URL with max 2048px dimension.
 *
 * 1. Try native browser decoding (JPEG/PNG/WebP + HEIC on Safari)
 * 2. If native fails and file is HEIC, lazy-load heic-to WASM decoder
 * 3. Output is always `image/jpeg` — compatible with all LLM vision providers
 */
export async function normalizeImage(file: File): Promise<string> {
  try {
    const img = await loadNative(file);
    return drawToJpeg(img);
  } catch {
    if (!isHeicFile(file)) throw new Error('Unsupported image format');

    const bitmap = await decodeHeic(file);
    return drawToJpeg(bitmap);
  }
}
