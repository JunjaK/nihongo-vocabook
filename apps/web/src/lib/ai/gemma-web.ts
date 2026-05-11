'use client';

import { normalizeExtractedTerm, shouldRejectExtractedTerm } from '@/lib/ocr/term-filter';
import { createLogger } from '@/lib/logger';
import type { ExtractedWord } from '@/lib/ocr/llm-vision';
import { isNativeApp } from '../native-bridge';
import {
  extractViaBridge,
  isBridgeReady as isNativeBridgeReady,
  nativeIneligibilityKey,
  triggerNativeDownload,
} from './native-bridge-adapter';
import {
  getModelStatus,
  setModelStatus,
  requestStoragePersist,
  subscribeModelStatus,
} from './model-manager';

// Qwen3.5-2B is the unified vision-language Qwen with MoE + Gated Delta Net;
// the q4f16 ONNX export is ≈1.51 GB total with a 1.04 GB largest shard, which
// is roughly half the size and largest-file of Gemma 4 E2B and gives mobile
// Safari's Cache Storage a much better shot at landing the download intact.
// Same `AutoModelForImageTextToText` API as before — drop-in swap.
const MODEL_ID = 'onnx-community/Qwen3.5-2B-ONNX-OPT';
const MAX_NEW_TOKENS = 1024;
// q4f16: decoder (1.04 GB) + embed_tokens (0.28 GB) + vision_encoder (0.19 GB)
// + tokenizer/configs ≈ 1.6 GB. Overestimate slightly so progress can't hit
// 100% from small files completing before big shards register their total.
const ESTIMATED_MODEL_BYTES = 1.6 * 1024 * 1024 * 1024;
const STATUS_THROTTLE_MS = 1000;
const SPEED_WINDOW_MS = 5000;
const CACHE_KEY = 'nivoca-ai-cache';
const logger = createLogger('ai:gemma-web');

interface ProgressEvent {
  status: string;
  file?: string;
  name?: string;
  progress?: number;
  loaded?: number;
  total?: number;
}

type ProcessorLike = {
  apply_chat_template: (messages: unknown, options?: unknown) => string;
  batch_decode: (batch: unknown, options?: unknown) => string[];
} & ((text: string, images?: unknown, audio?: unknown, options?: unknown) => Promise<{
  input_ids: { dims: number[] };
  [key: string]: unknown;
}>);

type GenerateInputs = {
  max_new_tokens?: number;
  do_sample?: boolean;
  [key: string]: unknown;
};

interface ModelLike {
  generate(inputs: GenerateInputs): Promise<{ slice: (...args: unknown[]) => unknown }>;
}

interface RawImageCtor {
  read(input: string): Promise<unknown>;
}

interface LoadedModel {
  processor: ProcessorLike;
  model: ModelLike;
  RawImage: RawImageCtor;
}

let modelPromise: Promise<LoadedModel> | null = null;
// Monotonically increasing per-load token. Cancellation bumps it so any
// progress event or terminal-state setter from a now-canceled load is ignored.
let activeLoadId = 0;
// Live AbortController bound to the current load — `env.fetch` is wired to
// this signal so cancellation actually stops the in-flight network requests
// instead of letting them complete and re-fill the cache.
let currentAbort: AbortController | null = null;

if (typeof window !== 'undefined') {
  subscribeModelStatus((status) => {
    if (status.state === 'not_installed') {
      currentAbort?.abort(new DOMException('Canceled by user', 'AbortError'));
      currentAbort = null;
      modelPromise = null;
      activeLoadId += 1;
    }
  });
}

function buildPrompt(locale: string): string {
  const meaningLang = locale === 'ko' ? 'Korean' : 'English';
  const example = locale === 'ko' ? '먹다' : 'to eat';
  return [
    'You are a Japanese vocabulary extractor. Extract Japanese words/phrases that are VISIBLE in this image.',
    '',
    'RULES:',
    '1. Extract ONLY text written in Japanese (kanji, hiragana, katakana). If the image contains Korean, Chinese, or English, IGNORE it — do NOT translate or convert non-Japanese text into Japanese.',
    '2. The image may contain vertical text (top-to-bottom columns, read right-to-left). Read vertical columns carefully and combine characters into complete words.',
    '3. Prefer compound words over isolated single kanji. E.g., extract 純米吟醸 as one term, not 純, 米, 吟, 醸 separately. Extract single kanji only when it genuinely stands alone.',
    '4. Be thorough — extract ALL readable Japanese words including menu items, labels, descriptions, katakana loanwords, and proper nouns.',
    '5. Convert inflected forms to dictionary form (e.g. 食べました → 食べる).',
    '6. Skip unreadable or heavily obscured text.',
    '',
    `For each word: dictionary form (term), reading in hiragana, meaning in ${meaningLang}, JLPT level (1-5, 5=N5 easiest, 1=N1 hardest, or null).`,
    '',
    'EXCLUDE: bare prefixes/suffixes (お, ご, 的, 性, 化), bare inflection endings (ます, ない, する, た), noise (ーー, repeated chars), affix marks (無-, -的).',
    '',
    `Max 50 words. Return ONLY a JSON array: [{"term": "食べる", "reading": "たべる", "meaning": "${example}", "jlptLevel": 4}]. No explanation.`,
  ].join('\n');
}

async function loadModel(loadId: number): Promise<LoadedModel> {
  setModelStatus({ state: 'downloading', progress: 0 });
  const mod = await import('@huggingface/transformers');

  // Use a project-specific cache key so the model's storage is identifiable
  // in DevTools and doesn't collide with other transformers.js apps that
  // might run on the same origin.
  mod.env.cacheKey = CACHE_KEY;

  // Dev mode: prefer files served from /public/models/ (populated by
  // `bun run download:gemma`). transformers.js still falls back to HuggingFace
  // when a file is missing locally (`hub.js:300` — 404 on local triggers the
  // remote path as long as `allowRemoteModels` stays true). That makes the
  // local mirror an opt-in cache — if the dev didn't run the download script,
  // behavior is unchanged; if they did, every dev-server restart and every
  // browser-cache wipe re-fetches in milliseconds from localhost.
  if (process.env.NODE_ENV === 'development') {
    mod.env.allowLocalModels = true;
    mod.env.localModelPath = '/models/';
  }

  // Hook into transformers.js's fetch indirection so we can actually abort
  // in-flight downloads on cancel. `env.fetch` is the single entry point used
  // by `hub.js → getFile()`; replacing it injects our AbortSignal into every
  // model file request, and the original is restored in `finally`.
  const controller = new AbortController();
  currentAbort = controller;
  const originalFetch = mod.env.fetch;
  mod.env.fetch = ((input: string | URL, init?: RequestInit) =>
    originalFetch(input, { ...(init ?? {}), signal: controller.signal })) as typeof mod.env.fetch;

  // Per-file byte tracking. We aggregate bytes across files but compute
  // displayed progress against an ESTIMATED total — that way small files
  // completing before big files appear can't pin the bar at 100%, and the bar
  // grows monotonically up to ~99% before the terminal "installed" state.
  const fileBytes = new Map<string, { loaded: number; total: number }>();
  const samples: Array<{ t: number; loaded: number }> = [];

  // Status updates are throttled to ≤1 Hz so we're not re-rendering the modal
  // dozens of times per second (each transformers.js progress event used to
  // emit). The trailing-edge timer guarantees the latest sample lands.
  let lastEmit = 0;
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;
  let pending: { loaded: number; reportedTotal: number } | null = null;

  const clearPendingTimer = () => {
    if (pendingTimer !== null) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }
  };

  const emit = () => {
    clearPendingTimer();
    if (!pending) return;
    if (loadId !== activeLoadId) return;

    const { loaded, reportedTotal } = pending;
    pending = null;

    const denom = Math.max(reportedTotal, ESTIMATED_MODEL_BYTES);
    const progress = Math.min(0.99, loaded / denom);

    const now = performance.now();
    const first = samples[0];
    const elapsed = first ? now - first.t : 0;
    const speedBps =
      first && elapsed > 500
        ? ((loaded - first.loaded) * 1000) / elapsed
        : undefined;
    const remaining = Math.max(0, denom - loaded);
    const etaSeconds =
      speedBps && speedBps > 0 ? Math.round(remaining / speedBps) : undefined;

    setModelStatus({
      state: 'downloading',
      progress,
      loadedBytes: loaded,
      totalBytes: reportedTotal,
      speedBps,
      etaSeconds,
    });
    lastEmit = now;
  };

  const scheduleEmit = (loaded: number, reportedTotal: number) => {
    pending = { loaded, reportedTotal };
    const now = performance.now();
    const delta = now - lastEmit;
    if (delta >= STATUS_THROTTLE_MS) {
      emit();
    } else if (pendingTimer === null) {
      pendingTimer = setTimeout(emit, STATUS_THROTTLE_MS - delta);
    }
  };

  const onProgress = (event: ProgressEvent) => {
    if (loadId !== activeLoadId) return;
    const key = event.file ?? event.name;
    if (!key) return;

    if (event.status === 'progress' && typeof event.total === 'number') {
      fileBytes.set(key, { loaded: event.loaded ?? 0, total: event.total });
    } else if (event.status === 'done') {
      const prev = fileBytes.get(key);
      if (prev) fileBytes.set(key, { loaded: prev.total, total: prev.total });
    } else {
      return;
    }

    let loaded = 0;
    let reportedTotal = 0;
    for (const v of fileBytes.values()) {
      loaded += v.loaded;
      reportedTotal += v.total;
    }
    if (reportedTotal <= 0) return;

    // Keep the rolling speed window updated even when we throttle the visible
    // status — otherwise speed estimates would be sampled too coarsely.
    const now = performance.now();
    samples.push({ t: now, loaded });
    while (samples.length > 1 && now - samples[0].t > SPEED_WINDOW_MS) {
      samples.shift();
    }

    scheduleEmit(loaded, reportedTotal);
  };

  try {
    const processor = (await mod.AutoProcessor.from_pretrained(MODEL_ID, {
      progress_callback: onProgress,
    })) as unknown as ProcessorLike;
    if (loadId !== activeLoadId) throw new Error('canceled');

    const model = (await mod.AutoModelForImageTextToText.from_pretrained(MODEL_ID, {
      dtype: 'q4f16',
      device: 'webgpu',
      progress_callback: onProgress,
    })) as unknown as ModelLike;
    if (loadId !== activeLoadId) throw new Error('canceled');

    clearPendingTimer();
    setModelStatus({ state: 'installed' });
    void requestStoragePersist();
    return {
      processor,
      model,
      RawImage: mod.RawImage as unknown as RawImageCtor,
    };
  } finally {
    clearPendingTimer();
    mod.env.fetch = originalFetch;
    if (currentAbort === controller) currentAbort = null;
  }
}

interface NavigatorWithGPU extends Navigator {
  gpu?: { requestAdapter: () => Promise<unknown | null> };
}

/**
 * Preflight gate before downloading the model. Two checks:
 *
 * 1. WebGPU must be available — onnxruntime-web's webgpu backend needs a real
 *    GPUAdapter or it throws `webgpuInit is not a function` deep inside the
 *    minified runtime (the exact error a user just hit on iOS Safari).
 * 2. iOS Safari (any iPhone / iPad WebKit) is hard-blocked even when WebGPU
 *    is technically present — the 1.5 GB ONNX model exceeds the per-tab
 *    memory cap during weight upload, so the OS reclaims the page near 90 %
 *    and the user sees a white refresh loop. Better to refuse upfront with
 *    a clear message than waste their bandwidth.
 *
 * Returns a translation key path the UI can render via t.aiModel.<key>.
 * `null` = clear to proceed.
 */
export async function checkDownloadEligibility(): Promise<string | null> {
  if (typeof window === 'undefined') return null;

  // Native iOS path takes over the eligibility decision — the native side
  // has the authoritative `Device.modelId` whitelist. While the bridge is
  // still initializing we conservatively claim eligibility (UI will reflect
  // the real answer as soon as AI_MODEL_STATUS_RESULT arrives).
  if (isNativeApp()) {
    return nativeIneligibilityKey();
  }

  const ua = navigator.userAgent;
  const isIOSWebKit = /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (isIOSWebKit) {
    return 'unsupportedIOS';
  }

  const nav = navigator as NavigatorWithGPU;
  if (!nav.gpu) {
    return 'unsupportedWebGPU';
  }
  try {
    const adapter = await nav.gpu.requestAdapter();
    if (!adapter) return 'unsupportedWebGPU';
  } catch {
    return 'unsupportedWebGPU';
  }

  return null;
}

export async function ensureGemmaReady(): Promise<void> {
  // Native iOS: the bridge owns the lifecycle. We translate "ensure ready"
  // into "kick off the download and let the model-manager listener flip the
  // state to installed". scan-store treats `isGemmaReady` as the truth.
  if (isNativeApp()) {
    const ineligibility = nativeIneligibilityKey();
    if (ineligibility) {
      setModelStatus({ state: 'error', message: ineligibility });
      throw new Error(ineligibility);
    }
    triggerNativeDownload();
    return;
  }

  if (!modelPromise) {
    const ineligibility = await checkDownloadEligibility();
    if (ineligibility) {
      // Surface as an error state with a structured key so the UI can show a
      // localized, actionable message instead of a stack trace.
      setModelStatus({ state: 'error', message: ineligibility });
      throw new Error(ineligibility);
    }
    const loadId = ++activeLoadId;
    modelPromise = loadModel(loadId).catch((err: unknown) => {
      modelPromise = null;
      // If this load was canceled, swallow — the cancel path already updated
      // status to not_installed and we must not stomp it back to 'error'.
      if (loadId !== activeLoadId) throw err;
      const message = err instanceof Error ? err.message : 'Model load failed';
      setModelStatus({ state: 'error', message });
      throw err;
    });
  }
  await modelPromise;
}

export function isGemmaReady(): boolean {
  // Native iOS — model-manager state is sinked from native via the bridge
  // adapter, so the answer is the same shape. `isNativeBridgeReady` simply
  // confirms we've heard back from native at least once.
  if (isNativeApp() && !isNativeBridgeReady()) return false;
  return getModelStatus().state === 'installed';
}

function parseJsonArray(content: string): ExtractedWord[] {
  const jsonMatch = content.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];

  let parsed: Record<string, unknown>[];
  try {
    parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>[];
  } catch {
    return [];
  }

  const seen = new Set<string>();
  return parsed
    .filter(
      (w) =>
        typeof w.term === 'string' &&
        typeof w.reading === 'string' &&
        typeof w.meaning === 'string',
    )
    .map((w) => {
      const term = normalizeExtractedTerm(w.term as string);
      const level =
        typeof w.jlptLevel === 'number' && w.jlptLevel >= 1 && w.jlptLevel <= 5
          ? w.jlptLevel
          : null;
      return {
        term,
        reading: w.reading as string,
        meaning: w.meaning as string,
        jlptLevel: level,
      };
    })
    .filter((word) => !shouldRejectExtractedTerm(word.term))
    .filter((word) => {
      if (seen.has(word.term)) return false;
      seen.add(word.term);
      return true;
    })
    .slice(0, 50);
}

export async function extractWithGemma(
  imageDataUrl: string,
  locale: string,
  signal?: AbortSignal,
): Promise<ExtractedWord[]> {
  if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');

  // Native iOS — round-trip through the Expo bridge to the LiteRT-LM runtime.
  // The returned shape is identical (`ExtractedWord[]`) so callers don't care.
  if (isNativeApp()) {
    return extractViaBridge(imageDataUrl, locale, signal);
  }

  await ensureGemmaReady();
  if (!modelPromise) throw new Error('Gemma model not initialized');

  const { processor, model, RawImage } = await modelPromise;
  if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');

  const prompt = buildPrompt(locale);
  const image = await RawImage.read(imageDataUrl);

  const messages = [
    {
      role: 'user',
      content: [
        { type: 'image' },
        { type: 'text', text: prompt },
      ],
    },
  ];

  const promptText = processor.apply_chat_template(messages, {
    add_generation_prompt: true,
  });

  const inputs = await processor(promptText, image, null, { add_special_tokens: false });
  if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');

  const started = performance.now();
  const generated = await model.generate({
    ...inputs,
    max_new_tokens: MAX_NEW_TOKENS,
    do_sample: false,
  });

  if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');

  const inputLength = inputs.input_ids.dims.at(-1) ?? 0;
  const newTokens = generated.slice(null, [inputLength, null]);
  const decoded = processor.batch_decode(newTokens, { skip_special_tokens: true });
  const text = decoded[0] ?? '';

  const words = parseJsonArray(text);
  logger.info('gemma_extracted', {
    ms: Math.round(performance.now() - started),
    count: words.length,
  });
  return words;
}
