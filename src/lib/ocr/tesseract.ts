import { createWorker } from 'tesseract.js';

const MAX_WORDS_PER_IMAGE = 50;
const JAPANESE_CHAR_REGEX = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\u3400-\u4DBF]/;
const JAPANESE_WORD_REGEX = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\u3400-\u4DBF]+/g;
const KANJI_REGEX = /[\u4E00-\u9FFF\u3400-\u4DBF]/;

interface ScoredWord {
  text: string;
  confidence: number;
}

export async function extractWithTesseract(
  imageDataUrl: string,
  onProgress?: (progress: number) => void,
  signal?: AbortSignal,
): Promise<string[]> {
  if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');

  const worker = await createWorker('jpn', undefined, {
    logger: (m) => {
      if (m.status === 'recognizing text' && onProgress) {
        onProgress(m.progress);
      }
    },
  });

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

    const { data } = await worker.recognize(imageDataUrl, {}, { blocks: true });
    if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');

    // Collect word-level confidence from Tesseract's structured output
    const scoredWords: ScoredWord[] = [];

    if (data.blocks) {
      for (const block of data.blocks) {
        for (const para of block.paragraphs) {
          for (const line of para.lines) {
            for (const word of line.words) {
              if (!JAPANESE_CHAR_REGEX.test(word.text)) continue;

              // Extract Japanese substrings (skip embedded ASCII/numbers)
              const matches = word.text.match(JAPANESE_WORD_REGEX);
              if (!matches) continue;

              for (const m of matches) {
                scoredWords.push({ text: m, confidence: word.confidence });
              }
            }
          }
        }
      }
    }

    return rankAndDedup(scoredWords);
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
    ([text]) => text.length >= 2 || KANJI_REGEX.test(text),
  );

  // Sort: confidence desc, kanji-containing first on tie, longer first on further tie
  entries.sort(([aText, aConf], [bText, bConf]) => {
    if (bConf !== aConf) return bConf - aConf;
    const aKanji = KANJI_REGEX.test(aText) ? 1 : 0;
    const bKanji = KANJI_REGEX.test(bText) ? 1 : 0;
    if (bKanji !== aKanji) return bKanji - aKanji;
    return bText.length - aText.length;
  });

  return entries.slice(0, MAX_WORDS_PER_IMAGE).map(([text]) => text);
}

/** Fallback: extract from raw text when blocks are unavailable. */
export function splitJapaneseText(text: string): string[] {
  const matches = text.match(JAPANESE_WORD_REGEX);
  if (!matches) return [];

  const unique = [...new Set(matches)];
  return unique
    .filter((w) => w.length >= 2 || KANJI_REGEX.test(w))
    .slice(0, MAX_WORDS_PER_IMAGE);
}
