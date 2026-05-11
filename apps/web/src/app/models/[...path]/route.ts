import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';

/**
 * Dev-only static route that serves AI model files from a path *outside* the
 * repo (default: `~/develop/ai/`). This lets us keep multi-GB Gemma weights
 * on the developer's machine once and serve them from `localhost` whenever
 * browser Cache Storage gets wiped (Playwright workers, profile resets,
 * DevTools "Clear site data", etc.).
 *
 * In production builds the route returns 404 — prod users always pull from
 * HuggingFace via transformers.js, never from the dev's filesystem.
 *
 * Files live at: `${GEMMA_LOCAL_DIR}/<repo-id>/<file>`
 *   e.g. `~/develop/ai/onnx-community/gemma-4-E2B-it-ONNX/config.json`
 * Populate via: `bun run download:gemma`.
 */

const DEFAULT_BASE = join(homedir(), 'develop', 'ai');
const MODEL_BASE = process.env.GEMMA_LOCAL_DIR ?? DEFAULT_BASE;
const MODEL_BASE_RESOLVED = resolve(MODEL_BASE);

function contentTypeFor(path: string): string {
  if (path.endsWith('.json')) return 'application/json';
  if (path.endsWith('.txt')) return 'text/plain';
  if (path.endsWith('.jinja')) return 'text/plain';
  // ONNX, .onnx_data, weights, tokenizer.json (treated as JSON above)
  return 'application/octet-stream';
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  if (process.env.NODE_ENV !== 'development') {
    return new Response('Not Found', { status: 404 });
  }

  const { path } = await params;
  if (!path || path.length === 0) {
    return new Response('Bad Request', { status: 400 });
  }

  // Reject any traversal attempt before path.join even sees it.
  if (path.some((seg) => seg === '..' || seg.includes('\0'))) {
    return new Response('Forbidden', { status: 403 });
  }

  const fullPath = resolve(join(MODEL_BASE_RESOLVED, ...path));
  // Defense-in-depth: even after resolve, the result must be inside the base.
  if (
    fullPath !== MODEL_BASE_RESOLVED &&
    !fullPath.startsWith(MODEL_BASE_RESOLVED + sep)
  ) {
    return new Response('Forbidden', { status: 403 });
  }

  let size: number;
  try {
    const s = await stat(fullPath);
    if (!s.isFile()) return new Response('Not Found', { status: 404 });
    size = s.size;
  } catch {
    return new Response('Not Found', { status: 404 });
  }

  const webStream = Readable.toWeb(createReadStream(fullPath)) as ReadableStream<Uint8Array>;
  return new Response(webStream, {
    headers: {
      'Content-Type': contentTypeFor(fullPath),
      'Content-Length': String(size),
      // Files are content-addressed by the HF revision; safe to cache hard
      // in the browser/Cache Storage layer above us.
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
