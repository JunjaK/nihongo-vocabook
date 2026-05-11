/**
 * Bridge between the native Swift `NivocaAi.infer(prompt, imagePath)` call
 * and the web's `AiExtractedWord[]` contract. The Swift side returns the
 * raw model text; we own prompt construction + JSON parsing + term filtering
 * so the LiteRT-LM engine's job stays minimal.
 *
 * Mirrors:
 *  - `apps/web/src/lib/ai/gemma-web.ts:buildPrompt` (verbatim)
 *  - `apps/web/src/lib/ai/gemma-web.ts:parseJsonArray` (verbatim)
 *  - `apps/web/src/lib/ocr/term-filter.ts` (copied)
 */

import { File, Paths } from 'expo-file-system';
import NivocaAi from '../../../modules/nivoca-ai';
import type { AiExtractedWord } from '../../types/bridge';
import {
  normalizeExtractedTerm,
  shouldRejectExtractedTerm,
} from './term-filter';

const MAX_WORDS = 50;

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

function parseJsonArray(content: string): AiExtractedWord[] {
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
    .slice(0, MAX_WORDS);
}

/**
 * Decode an `imageBase64` chunk (no `data:` URL prefix) into a temp jpg under
 * `cacheDirectory/ai-infer-<requestId>.jpg` so the Swift side can hand the
 * file path straight to LiteRT-LM's `kInputImage` data pointer.
 *
 * Returns the absolute path. Caller is responsible for cleanup.
 */
export async function writeBase64ToCache(
  imageBase64: string,
  requestId: string,
): Promise<string> {
  const file = new File(Paths.cache, `ai-infer-${requestId}.jpg`);
  if (file.exists) file.delete();
  file.create();
  // `write` accepts `string | Uint8Array`; passing base64 with the `base64`
  // encoding option lets the native side decode without round-tripping the
  // ~1 MB payload through a JS Uint8Array.
  file.write(imageBase64, { encoding: 'base64' });
  return file.uri;
}

/** Swift's `URL(fileURLWithPath:)` treats the whole input as a literal
 * filesystem path, so passing `file:///var/mobile/...` makes it try to read
 * a non-existent path that starts with `file:`. Strip the scheme before
 * crossing the bridge.
 */
function toNativePath(uri: string): string {
  return uri.replace(/^file:\/\//, '');
}

export async function runNativeInference(
  imageBase64: string,
  locale: string,
  requestId: string,
): Promise<AiExtractedWord[]> {
  const t0 = Date.now();
  console.log(
    `[nivoca-ai] runNativeInference start req=${requestId} locale=${locale} base64.len=${imageBase64.length}`,
  );
  const tmpUri = await writeBase64ToCache(imageBase64, requestId);
  const tmpPath = toNativePath(tmpUri);
  console.log(
    `[nivoca-ai] cache-file written: ${tmpUri} → swift path: ${tmpPath} (+${Date.now() - t0}ms)`,
  );
  try {
    const prompt = buildPrompt(locale);
    console.log(
      `[nivoca-ai] calling NivocaAi.infer prompt.len=${prompt.length}`,
    );
    const t1 = Date.now();
    const raw = await NivocaAi.infer(prompt, tmpPath);
    console.log(
      `[nivoca-ai] NivocaAi.infer returned in ${Date.now() - t1}ms raw.len=${raw.length}`,
    );
    const words = parseJsonArray(raw);
    console.log(`[nivoca-ai] parsed ${words.length} words`);
    return words;
  } catch (err) {
    // Surface the Swift error code/message in the JS log before bubbling up.
    // The bridge runs Swift `LocalizedError.errorDescription` through to
    // `err.message`, so the actual `code: message` string from
    // `NivocaAiError` is preserved here (instead of the cryptic Cocoa
    // `(unknown context).NivocaAiError error N.` placeholder).
    console.error(
      `[nivoca-ai] inference failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    throw err;
  } finally {
    try {
      // Cleanup uses the original `file://` URI form — `new File()` and
      // `Paths` operate on URIs, not bare paths.
      const file = new File(tmpUri);
      if (file.exists) file.delete();
    } catch {
      // best-effort cleanup
    }
  }
}
