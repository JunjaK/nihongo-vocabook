import { createWorker } from 'tesseract.js';
import { createLogger } from '@/lib/logger';
import { getExtractedTermRejectionReason, shouldRejectExtractedTerm } from './term-filter';

const MAX_WORDS_PER_IMAGE = 50;
const JAPANESE_CHAR_REGEX = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\u3400-\u4DBF]/;
const JAPANESE_WORD_REGEX = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\u3400-\u4DBF]+/g;
const KANJI_REGEX = /[\u4E00-\u9FFF\u3400-\u4DBF]/;
const SINGLE_KANJI_REGEX = /^[\u4E00-\u9FFF\u3400-\u4DBF]$/;
const HIRAGANA_ONLY_REGEX = /^[\u3040-\u309F]+$/;
const KATAKANA_ONLY_REGEX = /^[\u30A0-\u30FF]+$/;
const OCR_VARIANT_WEIGHTS = {
  original: 1,
  grayscaleContrast: 0.92,
  threshold: 0.88,
  rotatedCCW: 0.85,
  rotatedCW: 0.83,
  inverted: 0.80,
} as const;
const TESSERACT_PARAM_WARNING_PREFIX = 'Warning: Parameter not found:';
const logger = createLogger('ocr:tesseract');

interface ScoredWord {
  text: string;
  confidence: number;
}

interface OcrVariant {
  id: string;
  dataUrl: string;
  weight: number;
}

type RecognizeData = {
  blocks?: Array<{
    paragraphs: Array<{
      lines: Array<{
        words: Array<{ text: string; confidence: number }>;
      }>;
    }>;
  }>;
};

async function withSuppressedTesseractParamWarnings<T>(task: () => Promise<T>): Promise<T> {
  const originalWarn = console.warn;
  const originalError = console.error;
  let suppressedCount = 0;

  const shouldSuppress = (args: unknown[]): boolean =>
    args.some((arg) => typeof arg === 'string' && arg.includes(TESSERACT_PARAM_WARNING_PREFIX));

  console.warn = (...args: unknown[]) => {
    if (shouldSuppress(args)) {
      suppressedCount += 1;
      return;
    }
    originalWarn(...args);
  };

  console.error = (...args: unknown[]) => {
    if (shouldSuppress(args)) {
      suppressedCount += 1;
      return;
    }
    originalError(...args);
  };

  try {
    return await task();
  } finally {
    console.warn = originalWarn;
    console.error = originalError;
    if (suppressedCount > 0) {
      logger.info('suppressed_tesseract_warnings', { count: suppressedCount });
    }
  }
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load OCR source image'));
    img.src = dataUrl;
  });
}

function buildThresholdImageData(imageData: ImageData): ImageData {
  const pixels = imageData.data;
  let sum = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const gray = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
    sum += gray;
  }
  const threshold = sum / (pixels.length / 4);

  for (let i = 0; i < pixels.length; i += 4) {
    const gray = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
    const value = gray >= threshold ? 255 : 0;
    pixels[i] = value;
    pixels[i + 1] = value;
    pixels[i + 2] = value;
  }

  return imageData;
}

/** Detect if the image is likely dark-background (light text on dark). */
function isDarkBackground(imageData: ImageData): boolean {
  const pixels = imageData.data;
  let sum = 0;
  const pixelCount = pixels.length / 4;
  for (let i = 0; i < pixels.length; i += 4) {
    sum += 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
  }
  return sum / pixelCount < 128;
}

/** Invert the colors of an ImageData in-place (for dark background images). */
function invertImageData(imageData: ImageData): ImageData {
  const pixels = imageData.data;
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = 255 - pixels[i];
    pixels[i + 1] = 255 - pixels[i + 1];
    pixels[i + 2] = 255 - pixels[i + 2];
  }
  return imageData;
}

async function buildOcrVariants(imageDataUrl: string): Promise<OcrVariant[]> {
  const original: OcrVariant = {
    id: 'original',
    dataUrl: imageDataUrl,
    weight: OCR_VARIANT_WEIGHTS.original,
  };

  try {
    const source = await loadImage(imageDataUrl);
    const canvas = document.createElement('canvas');
    canvas.width = source.naturalWidth;
    canvas.height = source.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return [original];

    const variants: OcrVariant[] = [original];

    // Variant: grayscale + contrast
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.filter = 'grayscale(100%) contrast(140%)';
    ctx.drawImage(source, 0, 0);
    variants.push({
      id: 'grayscaleContrast',
      dataUrl: canvas.toDataURL('image/jpeg', 0.9),
      weight: OCR_VARIANT_WEIGHTS.grayscaleContrast,
    });

    // Variant: binary threshold
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.filter = 'none';
    ctx.drawImage(source, 0, 0);
    const rawImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const thresholdData = buildThresholdImageData(rawImageData);
    ctx.putImageData(thresholdData, 0, 0);
    variants.push({
      id: 'threshold',
      dataUrl: canvas.toDataURL('image/jpeg', 0.9),
      weight: OCR_VARIANT_WEIGHTS.threshold,
    });

    // Variant: rotated 90 degrees counter-clockwise (for vertical Japanese text).
    // Japanese vertical text reads top-to-bottom, right-to-left, so CCW rotation
    // converts it to the left-to-right horizontal layout that Tesseract expects.
    const rotCanvas = document.createElement('canvas');
    rotCanvas.width = source.naturalHeight;
    rotCanvas.height = source.naturalWidth;
    const rotCtx = rotCanvas.getContext('2d');
    if (rotCtx) {
      rotCtx.translate(0, rotCanvas.height);
      rotCtx.rotate(-Math.PI / 2);
      rotCtx.drawImage(source, 0, 0);
      variants.push({
        id: 'rotatedCCW',
        dataUrl: rotCanvas.toDataURL('image/jpeg', 0.9),
        weight: OCR_VARIANT_WEIGHTS.rotatedCCW,
      });
    }

    // Variant: rotated 90 degrees clockwise (some vertical text images need this direction)
    const rotCWCanvas = document.createElement('canvas');
    rotCWCanvas.width = source.naturalHeight;
    rotCWCanvas.height = source.naturalWidth;
    const rotCWCtx = rotCWCanvas.getContext('2d');
    if (rotCWCtx) {
      rotCWCtx.translate(rotCWCanvas.width, 0);
      rotCWCtx.rotate(Math.PI / 2);
      rotCWCtx.drawImage(source, 0, 0);
      variants.push({
        id: 'rotatedCW',
        dataUrl: rotCWCanvas.toDataURL('image/jpeg', 0.9),
        weight: OCR_VARIANT_WEIGHTS.rotatedCW,
      });
    }

    // Variant: inverted (for dark background images)
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.filter = 'none';
    ctx.drawImage(source, 0, 0);
    const checkData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    if (isDarkBackground(checkData)) {
      invertImageData(checkData);
      ctx.putImageData(checkData, 0, 0);
      variants.push({
        id: 'inverted',
        dataUrl: canvas.toDataURL('image/jpeg', 0.9),
        weight: OCR_VARIANT_WEIGHTS.inverted,
      });
    }

    return variants;
  } catch {
    return [original];
  }
}

function collectScoredWords(data: RecognizeData, weight: number): ScoredWord[] {
  const scoredWords: ScoredWord[] = [];
  if (!data.blocks) return scoredWords;

  for (const block of data.blocks) {
    for (const para of block.paragraphs) {
      for (const line of para.lines) {
        const lineTokens: ScoredWord[] = [];

        for (const word of line.words) {
          if (!JAPANESE_CHAR_REGEX.test(word.text)) continue;

          const matches = word.text.match(JAPANESE_WORD_REGEX);
          if (!matches) continue;

          for (const match of matches) {
            lineTokens.push({ text: match, confidence: word.confidence * weight });
          }
        }

        scoredWords.push(...lineTokens);

        // Combine adjacent katakana chunks (e.g. フレ+ッシュ -> フレッシュ).
        // Also handle 3-token chains (e.g. フル+ーテ+ィー -> フルーティー).
        for (let i = 0; i < lineTokens.length - 1; i++) {
          const current = lineTokens[i];
          const next = lineTokens[i + 1];
          const currentIsKatakana = KATAKANA_ONLY_REGEX.test(current.text);
          const nextIsKatakana = KATAKANA_ONLY_REGEX.test(next.text);

          if (!currentIsKatakana || !nextIsKatakana) continue;

          const combined = `${current.text}${next.text}`;
          if (combined.length >= 3 && combined.length <= 10) {
            scoredWords.push({
              text: combined,
              confidence: ((current.confidence + next.confidence) / 2) * 0.9,
            });
          }

          // Try 3-token katakana chain
          if (i + 2 < lineTokens.length) {
            const third = lineTokens[i + 2];
            if (KATAKANA_ONLY_REGEX.test(third.text)) {
              const triple = `${current.text}${next.text}${third.text}`;
              if (triple.length >= 4 && triple.length <= 10) {
                scoredWords.push({
                  text: triple,
                  confidence:
                    ((current.confidence + next.confidence + third.confidence) / 3) * 0.85,
                });
              }
            }
          }
        }

        // Combine adjacent single-kanji tokens to reduce over-splitting (e.g. 世+界 -> 世界).
        for (let i = 0; i < lineTokens.length - 1; i++) {
          const first = lineTokens[i];
          const second = lineTokens[i + 1];
          if (!SINGLE_KANJI_REGEX.test(first.text) || !SINGLE_KANJI_REGEX.test(second.text)) continue;

          const twoKanji = `${first.text}${second.text}`;
          scoredWords.push({
            text: twoKanji,
            confidence: ((first.confidence + second.confidence) / 2) * 0.95,
          });

          if (i + 2 < lineTokens.length) {
            const third = lineTokens[i + 2];
            if (SINGLE_KANJI_REGEX.test(third.text)) {
              const threeKanji = `${first.text}${second.text}${third.text}`;
              scoredWords.push({
                text: threeKanji,
                confidence: ((first.confidence + second.confidence + third.confidence) / 3) * 0.9,
              });
            }

            // Also try 4-kanji compound
            if (SINGLE_KANJI_REGEX.test(third.text) && i + 3 < lineTokens.length) {
              const fourth = lineTokens[i + 3];
              if (SINGLE_KANJI_REGEX.test(fourth.text)) {
                const fourKanji = `${first.text}${second.text}${third.text}${fourth.text}`;
                scoredWords.push({
                  text: fourKanji,
                  confidence:
                    ((first.confidence + second.confidence + third.confidence + fourth.confidence) / 4) * 0.85,
                });
              }
            }
          }
        }

        // Combine kanji + short hiragana chunks (e.g. 眺 + め -> 眺め, 眺め + ながら -> 眺めながら).
        for (let i = 0; i < lineTokens.length - 1; i++) {
          const first = lineTokens[i];
          const second = lineTokens[i + 1];

          const isKanjiPrefix = KANJI_REGEX.test(first.text);
          const isShortHiragana = HIRAGANA_ONLY_REGEX.test(second.text) && second.text.length <= 4;
          if (!isKanjiPrefix || !isShortHiragana) continue;

          const mixed = `${first.text}${second.text}`;
          scoredWords.push({
            text: mixed,
            confidence: ((first.confidence + second.confidence) / 2) * 0.93,
          });

          if (i + 2 < lineTokens.length) {
            const third = lineTokens[i + 2];
            if (HIRAGANA_ONLY_REGEX.test(third.text) && third.text.length <= 4) {
              const mixedLong = `${mixed}${third.text}`;
              scoredWords.push({
                text: mixedLong,
                confidence: ((first.confidence + second.confidence + third.confidence) / 3) * 0.88,
              });
            }
            // Also try kanji+hiragana+kanji (e.g. 亀+の+海 -> 亀の海)
            if (KANJI_REGEX.test(third.text) && second.text.length <= 2) {
              const kanjiHiraKanji = `${first.text}${second.text}${third.text}`;
              scoredWords.push({
                text: kanjiHiraKanji,
                confidence: ((first.confidence + second.confidence + third.confidence) / 3) * 0.9,
              });
            }
          }
        }
      }
    }
  }

  return scoredWords;
}

export async function extractWithTesseract(
  imageDataUrl: string,
  onProgress?: (progress: number) => void,
  signal?: AbortSignal,
): Promise<string[]> {
  if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');

  const variants = await buildOcrVariants(imageDataUrl);
  let activePass = 0;

  const workerLogger = (m: { status: string; progress: number }) => {
    if (m.status === 'recognizing text' && onProgress) {
      const progress = (activePass + m.progress) / variants.length;
      onProgress(Math.min(progress, 1));
    }
  };

  const worker = await withSuppressedTesseractParamWarnings(() =>
    createWorker('jpn', undefined, { logger: workerLogger }),
  );

  let terminated = false;
  const terminateSafely = async () => {
    if (terminated) return;
    terminated = true;
    await worker.terminate();
  };

  const onAbort = () => {
    void terminateSafely();
  };
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');

    const scoredWords: ScoredWord[] = [];

    for (let i = 0; i < variants.length; i++) {
      if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');

      const variant = variants[i];
      activePass = i;
      const { data } = await worker.recognize(variant.dataUrl, {}, { blocks: true });
      scoredWords.push(...collectScoredWords(data as RecognizeData, variant.weight));
    }

    if (onProgress) onProgress(1);

    const rawUniqueTokens = [...new Set(scoredWords.map((word) => word.text))];
    const {
      output: processed,
      byLengthRejected,
      byPatternRejected,
      byCapRejected,
    } = inspectRankAndDedup(scoredWords);

    const rejectedReasonCount = byPatternRejected.reduce<Record<string, number>>((acc, token) => {
      const reason = getExtractedTermRejectionReason(token);
      if (!reason) return acc;
      acc[reason] = (acc[reason] ?? 0) + 1;
      return acc;
    }, {});

    logger.info('raw_tokens', {
      variantCount: variants.length,
      totalDetected: scoredWords.length,
      uniqueCount: rawUniqueTokens.length,
      tokens: rawUniqueTokens,
    });

    logger.info('processed_tokens', {
      keptCount: processed.length,
      rejectedCount: rawUniqueTokens.length - processed.length,
      rejectedByLengthCount: byLengthRejected.length,
      rejectedByPatternCount: byPatternRejected.length,
      rejectedByCapCount: byCapRejected.length,
      rejectedReasonCount,
      tokens: processed,
    });

    return processed;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    await terminateSafely();
  }
}

/** Deduplicate, score, sort, and cap at MAX_WORDS_PER_IMAGE. */
function rankAndDedup(words: ScoredWord[]): string[] {
  // Dedup: keep highest confidence per unique text
  const best = new Map<string, number>();
  for (const w of words) {
    const prev = best.get(w.text);
    if (prev === undefined || w.confidence > prev) {
      best.set(w.text, w.confidence);
    }
  }

  // Filter: 2+ chars, or single kanji
  const entries = [...best.entries()].filter(
    ([text]) => (text.length >= 2 || KANJI_REGEX.test(text)) && !shouldRejectExtractedTerm(text),
  );

  const tokenSet = new Set(entries.map(([text]) => text));
  const compactEntries = entries.filter(([text]) => !shouldSuppressFragmentToken(text, tokenSet));

  // Sort: confidence desc, kanji-containing first on tie, longer first on further tie
  compactEntries.sort(([aText, aConf], [bText, bConf]) => {
    if (bConf !== aConf) return bConf - aConf;
    const aKanji = KANJI_REGEX.test(aText) ? 1 : 0;
    const bKanji = KANJI_REGEX.test(bText) ? 1 : 0;
    if (bKanji !== aKanji) return bKanji - aKanji;
    return bText.length - aText.length;
  });

  return compactEntries.slice(0, MAX_WORDS_PER_IMAGE).map(([text]) => text);
}

function inspectRankAndDedup(words: ScoredWord[]): {
  output: string[];
  byLengthRejected: string[];
  byPatternRejected: string[];
  byCapRejected: string[];
} {
  const best = new Map<string, number>();
  for (const w of words) {
    const prev = best.get(w.text);
    if (prev === undefined || w.confidence > prev) {
      best.set(w.text, w.confidence);
    }
  }

  const byLengthRejected: string[] = [];
  const byPatternRejected: string[] = [];
  const byFragmentRejected: string[] = [];
  const candidates: Array<[string, number]> = [];

  for (const [text, confidence] of best.entries()) {
    const passLength = text.length >= 2 || KANJI_REGEX.test(text);
    if (!passLength) {
      byLengthRejected.push(text);
      continue;
    }
    if (shouldRejectExtractedTerm(text)) {
      byPatternRejected.push(text);
      continue;
    }
    candidates.push([text, confidence]);
  }

  const candidateSet = new Set(candidates.map(([text]) => text));
  const compactCandidates = candidates.filter(([text]) => {
    const suppressed = shouldSuppressFragmentToken(text, candidateSet);
    if (suppressed) byFragmentRejected.push(text);
    return !suppressed;
  });

  compactCandidates.sort(([aText, aConf], [bText, bConf]) => {
    if (bConf !== aConf) return bConf - aConf;
    const aKanji = KANJI_REGEX.test(aText) ? 1 : 0;
    const bKanji = KANJI_REGEX.test(bText) ? 1 : 0;
    if (bKanji !== aKanji) return bKanji - aKanji;
    return bText.length - aText.length;
  });

  const output = compactCandidates.slice(0, MAX_WORDS_PER_IMAGE).map(([text]) => text);
  const byCapRejected = compactCandidates.slice(MAX_WORDS_PER_IMAGE).map(([text]) => text);
  return {
    output,
    byLengthRejected,
    byPatternRejected: [...byPatternRejected, ...byFragmentRejected],
    byCapRejected,
  };
}

function shouldSuppressFragmentToken(token: string, tokenSet: Set<string>): boolean {
  for (const candidate of tokenSet) {
    if (candidate === token) continue;
    if (candidate.length <= token.length) continue;
    if (!candidate.includes(token)) continue;

    if (token.length === 1) return true;

    const isShortKana =
      (KATAKANA_ONLY_REGEX.test(token) || HIRAGANA_ONLY_REGEX.test(token)) && token.length <= 3;
    if (isShortKana) return true;

    const isShortKanjiChunk = token.length <= 2 && KANJI_REGEX.test(token);
    if (isShortKanjiChunk && candidate.length >= 3) return true;
  }

  return false;
}

/** Fallback: extract from raw text when blocks are unavailable. */
export function splitJapaneseText(text: string): string[] {
  const matches = text.match(JAPANESE_WORD_REGEX);
  if (!matches) return [];

  const unique = [...new Set(matches)];
  return unique
    .filter((w) => (w.length >= 2 || KANJI_REGEX.test(w)) && !shouldRejectExtractedTerm(w))
    .slice(0, MAX_WORDS_PER_IMAGE);
}
