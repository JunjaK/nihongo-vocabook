#!/usr/bin/env bun
/**
 * Download the Gemma 4 E2B (ONNX, q4f16) model files from HuggingFace into a
 * shared, repo-external directory (default `~/develop/ai/<repo>/`). The dev
 * server's `/models/[...path]` route handler streams from there, so multiple
 * projects can share the same multi-GB weights and they survive `git clean`,
 * branch switches, repo reclones, etc.
 *
 * Override the destination with `GEMMA_LOCAL_DIR=/somewhere/else`. The path
 * used here must match the one in `apps/web/src/app/models/[...path]/route.ts`.
 *
 * Idempotent — already-downloaded files with matching size are skipped.
 * Safe to Ctrl-C and re-run; partial files are detected via `stat` size mismatch.
 */

import { createWriteStream } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

// Must match MODEL_ID in src/lib/ai/gemma-web.ts (web/desktop path).
// iOS native uses a different model (Gemma 4) outside this script.
const MODEL_ID = 'onnx-community/Qwen3.5-2B-ONNX-OPT';
const REVISION = 'main';
const DTYPE_TAG = 'q4f16';

const MODEL_BASE = process.env.GEMMA_LOCAL_DIR ?? join(homedir(), 'develop', 'ai');
const TARGET_DIR = join(MODEL_BASE, MODEL_ID);

interface HubFile {
  type: 'file' | 'directory';
  path: string;
  size: number;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

async function listFiles(): Promise<HubFile[]> {
  const url = `https://huggingface.co/api/models/${MODEL_ID}/tree/${REVISION}?recursive=true`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to list files: HTTP ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as HubFile[];
}

// `.onnx_data` files are sometimes sharded into `.onnx_data_1`, `.onnx_data_2`, …
// for large variants. Catch both forms so the filter actually excludes them.
const ONNX_DATA_RE = /\.onnx_data(_\d+)?$/;

function isNeeded(file: HubFile): boolean {
  // All non-ONNX metadata stays (configs, tokenizer, processor, chat template)
  const isOnnxArtifact = file.path.endsWith('.onnx') || ONNX_DATA_RE.test(file.path);
  if (!isOnnxArtifact) {
    // Skip git/markdown metadata
    if (file.path === '.gitattributes' || file.path === 'README.md') return false;
    return true;
  }
  // Only the dtype variant we use at runtime. The token is checked with
  // surrounding underscore/dot anchors so `_q4f16.` doesn't accidentally match
  // a substring of another tag.
  return file.path.includes(`_${DTYPE_TAG}.`);
}

async function alreadyDownloaded(localPath: string, expectedSize: number): Promise<boolean> {
  try {
    const s = await stat(localPath);
    return s.size === expectedSize;
  } catch {
    return false;
  }
}

async function downloadFile(file: HubFile, idx: number, total: number): Promise<void> {
  const localPath = join(TARGET_DIR, file.path);

  if (await alreadyDownloaded(localPath, file.size)) {
    console.log(`[${idx}/${total}] ✓ ${file.path} (${formatBytes(file.size)} cached)`);
    return;
  }

  await mkdir(dirname(localPath), { recursive: true });
  const url = `https://huggingface.co/${MODEL_ID}/resolve/${REVISION}/${file.path}`;
  const start = performance.now();
  process.stdout.write(`[${idx}/${total}] ↓ ${file.path} (${formatBytes(file.size)}) … `);

  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Failed to fetch ${file.path}: HTTP ${res.status}`);
  if (!res.body) throw new Error(`No response body for ${file.path}`);

  // Stream through Node's pipeline so we never buffer the whole body in memory
  // (1.5GB ONNX shards would OOM otherwise) and so errors actually surface.
  await pipeline(
    Readable.fromWeb(res.body as import('node:stream/web').ReadableStream),
    createWriteStream(localPath),
  );

  const written = (await stat(localPath)).size;
  if (file.size > 0 && written !== file.size) {
    throw new Error(
      `Size mismatch for ${file.path}: expected ${file.size}, wrote ${written}`,
    );
  }

  const elapsed = (performance.now() - start) / 1000;
  console.log(`done in ${elapsed.toFixed(1)}s`);
}

async function main(): Promise<void> {
  console.log(`Listing files for ${MODEL_ID}@${REVISION}…`);
  const all = await listFiles();
  const needed = all
    .filter((f) => f.type === 'file')
    .filter(isNeeded)
    .sort((a, b) => a.size - b.size); // small files first (configs) so the UI smokes out early

  const totalSize = needed.reduce((sum, f) => sum + f.size, 0);
  console.log(
    `\n${needed.length} files, ${formatBytes(totalSize)} total\nTarget: ${TARGET_DIR}\n`,
  );

  for (let i = 0; i < needed.length; i++) {
    await downloadFile(needed[i], i + 1, needed.length);
  }
  console.log(`\n✓ Done. Restart the dev server to pick up local model files.`);
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
