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
// A real dictionary entry is rarely longer than this — anything over the cap
// is almost certainly a chained noun phrase or an entire title that should
// be decomposed into its constituent vocabulary words.
const MAX_TERM_LENGTH = 10;
// Honorific prefixes the model often (correctly) recognises but then
// duplicates: it outputs both お城 and 城 even when the bare form is the
// real dictionary entry. We drop the prefixed form post-hoc only when the
// bare form is also present in the same response, so fixed compounds like
// 御朱印 stay untouched.
const HONORIFIC_PREFIXES = ['お', 'ご', '御'];

function stripHonorificPrefix(term: string): string | null {
  for (const prefix of HONORIFIC_PREFIXES) {
    if (term.startsWith(prefix) && term.length > prefix.length) {
      return term.slice(prefix.length);
    }
  }
  return null;
}

function buildPrompt(locale: string): string {
  const meaningLang = locale === 'ko' ? 'Korean' : 'English';
  const example = locale === 'ko' ? '먹다' : 'to eat';
  return [
    'You are a Japanese vocabulary extractor. Extract individual Japanese vocabulary items visible in this image.',
    '',
    'HARD RULES:',
    `1. Every "term" MUST be ≤${MAX_TERM_LENGTH} characters. Anything longer is a phrase, not a word — break it up.`,
    '2. Extract ONLY Japanese text (kanji, hiragana, katakana). Ignore Korean, Chinese, English.',
    '3. Each unique word ONCE — no duplicates.',
    '',
    'DECOMPOSITION (apply rule 1 aggressively):',
    '   - "東京都個人情報保護方針" → split into: 東京都, 個人情報, 保護, 方針',
    '   - "中央図書館利用案内" → split into: 中央, 図書館, 利用案内',
    '   - Drop counter/ordinal prefixes (第N回, 第N代, etc.) and decorative numbers.',
    '   - Drop honorifics on the front when used as labels (お, ご) unless part of a fixed compound (御朱印 keeps the 御).',
    '',
    'KEEP these conventional compounds together (single dictionary entries):',
    '   - 入館料, 図書館, 純米吟醸, 御朱印, 駐車場, 個人情報, 利用案内',
    '',
    'HONORIFIC PREFIX (お, ご, 御): output only the bare form when the bare form is itself a valid word.',
    '   - お城 → output 城 (drop the お). お酒 → output 酒. ご注文 → output 注文. お弁当 → output 弁当.',
    '   - Keep the prefix only when it is integral to a fixed compound that does NOT stand alone without it: 御朱印, 御殿, お土産, おにぎり, おでん, ご飯.',
    '   - Never output BOTH the bare form and the prefixed form for the same root.',
    '',
    'OTHER:',
    '   - Vertical text: read top-to-bottom, right-to-left, combine into complete words.',
    '   - Convert inflected forms to dictionary form (食べました → 食べる, 開催！ → 開催する).',
    '   - Skip unreadable / heavily obscured text.',
    '   - Aim for MANY short entries, not few long titles. Target ~20–40 entries from a paragraph-sized image.',
    '',
    `For each word: dictionary form (term, ≤${MAX_TERM_LENGTH} chars), hiragana reading, meaning in ${meaningLang}, JLPT level (5=easiest N5 ... 1=hardest N1, or null if unsure).`,
    '',
    'EXCLUDE: bare prefixes/suffixes (お, ご, 的, 性, 化), bare inflection endings (ます, ない, する, た), noise (ーー, repeated chars).',
    '',
    `OUTPUT: Return ONLY a raw JSON array. No markdown fences, no \`\`\`json wrapper, no commentary. Example: [{"term": "食べる", "reading": "たべる", "meaning": "${example}", "jlptLevel": 4}]`,
    'Max 50 entries.',
  ].join('\n');
}

/**
 * Build a follow-up prompt that asks the model to decompose specific long
 * phrases into their constituent vocabulary words. Reuses the same image
 * (the model will see it again, which is wasted compute but lets us call
 * the existing `infer(prompt, imagePath)` API without adding a text-only
 * variant on the native side).
 */
function buildDecompositionPrompt(longTerms: string[], locale: string): string {
  const meaningLang = locale === 'ko' ? 'Korean' : 'English';
  const example = locale === 'ko' ? '먹다' : 'to eat';
  const listLines = longTerms.map((t) => `- ${t}`);
  return [
    'You are a Japanese vocabulary decomposer.',
    'The following phrases were extracted as single terms but are too long to be dictionary words.',
    `Decompose each into its constituent vocabulary words (each ≤${MAX_TERM_LENGTH} characters).`,
    '',
    'PHRASES TO DECOMPOSE:',
    ...listLines,
    '',
    'RULES:',
    `1. Each "term" MUST be ≤${MAX_TERM_LENGTH} characters.`,
    '2. Drop counter/ordinal prefixes (第N回, etc.) and punctuation.',
    '3. Include each unique word ONCE.',
    '4. Convert inflected forms to dictionary form.',
    '',
    `For each word: dictionary form (term), hiragana reading, meaning in ${meaningLang}, JLPT level (1–5 or null).`,
    '',
    `OUTPUT: Return ONLY a raw JSON array, no markdown. Example: [{"term": "食べる", "reading": "たべる", "meaning": "${example}", "jlptLevel": 4}]`,
  ].join('\n');
}

/**
 * Walk the raw model output as if it were a JSON array of objects,
 * collecting each top-level `{...}` that we can balance-match. Tolerates:
 *  - markdown code fences around the array
 *  - extra closing braces before the final `]` (model glitch)
 *  - truncated tail when the model hit max_output_tokens mid-entry —
 *    we keep whatever earlier items completed successfully
 *
 * Tries JSON.parse on the full array first (fast path); falls back to
 * the per-item walker only when that fails.
 */
function parseJsonArray(content: string): AiExtractedWord[] {
  const start = content.indexOf('[');
  if (start === -1) return [];

  // Fast paths: try the full match as-is, then with a "}}…]" → "}…]" repair.
  const tail = content.slice(start);
  const fullMatch = tail.match(/\[[\s\S]*\]/);
  const fastCandidates: string[] = [];
  if (fullMatch) {
    fastCandidates.push(fullMatch[0]);
    fastCandidates.push(fullMatch[0].replace(/}(\s*})+(\s*])/g, '}$2'));
  }
  let parsed: Record<string, unknown>[] | null = null;
  for (const candidate of fastCandidates) {
    try {
      const result = JSON.parse(candidate);
      if (Array.isArray(result)) {
        parsed = result as Record<string, unknown>[];
        break;
      }
    } catch {
      // try next strategy
    }
  }

  // Fallback: walk the array character-by-character and parse each balanced
  // {...} object individually. Skips malformed/truncated items.
  if (!parsed) {
    parsed = [];
    let depth = 0;
    let inString = false;
    let escape = false;
    let itemStart = -1;
    for (let i = start + 1; i < content.length; i++) {
      const c = content[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (inString) {
        if (c === '\\') escape = true;
        else if (c === '"') inString = false;
        continue;
      }
      if (c === '"') {
        inString = true;
        continue;
      }
      if (c === '{') {
        if (depth === 0) itemStart = i;
        depth++;
      } else if (c === '}') {
        depth--;
        if (depth === 0 && itemStart >= 0) {
          const slice = content.slice(itemStart, i + 1);
          try {
            const obj = JSON.parse(slice) as Record<string, unknown>;
            parsed.push(obj);
          } catch {
            // skip malformed item
          }
          itemStart = -1;
        }
      } else if (c === ']' && depth === 0) {
        break;
      }
    }
    if (parsed.length === 0) return [];
  }

  const seen = new Set<string>();
  const dedupedByTerm = parsed
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
    });

  // Drop honorific-prefixed duplicates: if both "お城" and "城" are present,
  // we want just "城". Fixed compounds (御朱印) survive because the bare form
  // (朱印) isn't in the set.
  const bareTermsSeen = new Set(
    dedupedByTerm
      .map((w) => stripHonorificPrefix(w.term))
      .filter((bare): bare is string => bare !== null && dedupedByTerm.some((x) => x.term === bare)),
  );
  // bareTermsSeen now contains the bare forms whose prefixed sibling we want
  // to remove. Rebuild the list, dropping any entry whose own term is the
  // prefixed sibling of an in-set bare form.
  const honorificFiltered = dedupedByTerm.filter((word) => {
    const bare = stripHonorificPrefix(word.term);
    return !(bare !== null && bareTermsSeen.has(bare));
  });

  return honorificFiltered.slice(0, MAX_WORDS);
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
    // Diagnostic — surface the model output verbatim so we can tell whether
    // an empty word list comes from an empty/garbled response or a JSON
    // shape mismatch. Trim long outputs to keep the dev console readable.
    console.log(
      `[nivoca-ai] raw.head=${JSON.stringify(raw.slice(0, 800))}`,
    );
    if (raw.length > 800) {
      console.log(
        `[nivoca-ai] raw.tail=${JSON.stringify(raw.slice(-200))}`,
      );
    }
    let words = parseJsonArray(raw);
    console.log(`[nivoca-ai] parsed ${words.length} words`);

    // Two-pass decomposition: if the model produced any phrase longer than
    // MAX_TERM_LENGTH chars, re-feed those phrases asking to split them.
    // We deliberately reuse `tmpPath` (the original image) because the
    // native bridge requires it; the vision encoder work is wasted on the
    // second call but it avoids adding a text-only Swift API today.
    const longTerms = words
      .filter((w) => w.term.length > MAX_TERM_LENGTH)
      .map((w) => w.term);
    if (longTerms.length > 0) {
      console.log(
        `[nivoca-ai] decomposing ${longTerms.length} long terms: ${JSON.stringify(longTerms)}`,
      );
      const decompPrompt = buildDecompositionPrompt(longTerms, locale);
      const t2 = Date.now();
      const decompRaw = await NivocaAi.infer(decompPrompt, tmpPath);
      console.log(
        `[nivoca-ai] decomposition pass returned in ${Date.now() - t2}ms raw.len=${decompRaw.length}`,
      );
      const decomposed = parseJsonArray(decompRaw);
      console.log(`[nivoca-ai] decomposition produced ${decomposed.length} words`);

      // Merge: drop the long originals, keep the short originals, append
      // the decomposed entries. Dedupe by term, preserving first-seen entry.
      const seen = new Set<string>();
      const merged: AiExtractedWord[] = [];
      for (const w of [...words, ...decomposed]) {
        if (w.term.length > MAX_TERM_LENGTH) continue; // drop anything still too long
        if (seen.has(w.term)) continue;
        seen.add(w.term);
        merged.push(w);
      }
      words = merged.slice(0, MAX_WORDS);
      console.log(`[nivoca-ai] after merge: ${words.length} words`);
    }
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
