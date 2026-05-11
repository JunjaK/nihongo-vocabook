'use client';

import { normalizeExtractedTerm, shouldRejectExtractedTerm } from '@/lib/ocr/term-filter';
import { createLogger } from '@/lib/logger';
import type { ExtractedWord } from '@/lib/ocr/llm-vision';
import {
  getModelStatus,
  setModelStatus,
  requestStoragePersist,
} from './model-manager';

const MODEL_ID = 'onnx-community/gemma-4-E2B-it-ONNX';
const MAX_NEW_TOKENS = 1024;
const logger = createLogger('ai:gemma-web');

interface ProgressEvent {
  status: string;
  progress?: number;
  loaded?: number;
  total?: number;
}

interface LoadedModel {
  processor: ProcessorLike;
  model: ModelLike;
  RawImage: RawImageCtor;
}

interface ProcessorLike {
  apply_chat_template(messages: unknown, options: Record<string, unknown>): string;
  batch_decode(ids: unknown, options: { skip_special_tokens: boolean }): string[];
  (text: string, image: unknown, options?: Record<string, unknown>): Promise<{
    input_ids: { dims: number[] };
    [key: string]: unknown;
  }>;
}

interface ModelLike {
  generate(inputs: Record<string, unknown>): Promise<{ slice(...args: unknown[]): unknown }>;
}

interface RawImageCtor {
  read(input: string): Promise<unknown>;
}

let modelPromise: Promise<LoadedModel> | null = null;

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

async function loadModel(): Promise<LoadedModel> {
  setModelStatus({ state: 'downloading', progress: 0 });
  const mod = await import('@huggingface/transformers');

  const onProgress = (event: ProgressEvent) => {
    if (event.status === 'progress' && typeof event.progress === 'number') {
      setModelStatus({ state: 'downloading', progress: Math.min(1, event.progress / 100) });
    }
  };

  const processor = (await mod.AutoProcessor.from_pretrained(MODEL_ID, {
    progress_callback: onProgress,
  })) as unknown as ProcessorLike;

  const model = (await mod.AutoModelForImageTextToText.from_pretrained(MODEL_ID, {
    dtype: 'q4f16',
    device: 'webgpu',
    progress_callback: onProgress,
  })) as unknown as ModelLike;

  setModelStatus({ state: 'installed' });
  void requestStoragePersist();
  return {
    processor,
    model,
    RawImage: mod.RawImage as unknown as RawImageCtor,
  };
}

export async function ensureGemmaReady(): Promise<void> {
  if (!modelPromise) {
    modelPromise = loadModel().catch((err: unknown) => {
      modelPromise = null;
      const message = err instanceof Error ? err.message : 'Model load failed';
      setModelStatus({ state: 'error', message });
      throw err;
    });
  }
  await modelPromise;
}

export function isGemmaReady(): boolean {
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
    tokenize: false,
  });

  const inputs = await processor(promptText, image, { add_special_tokens: false });
  if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');

  const started = performance.now();
  const generated = await model.generate({
    ...inputs,
    max_new_tokens: MAX_NEW_TOKENS,
    do_sample: false,
  });

  if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');

  const inputLength = inputs.input_ids.dims[1];
  const newTokens = (generated as { slice: (...a: unknown[]) => unknown }).slice(
    null,
    [inputLength, null],
  );
  const decoded = processor.batch_decode(newTokens, { skip_special_tokens: true });
  const text = decoded[0] ?? '';

  const words = parseJsonArray(text);
  logger.info('gemma_extracted', {
    ms: Math.round(performance.now() - started),
    count: words.length,
  });
  return words;
}
