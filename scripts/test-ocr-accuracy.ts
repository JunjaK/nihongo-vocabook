/**
 * OCR Accuracy Test Script
 *
 * Tests Tesseract.js OCR extraction against ground truth for 7 test images.
 * Produces per-image and overall precision/recall/F1 metrics.
 *
 * Uses the same post-processing logic as the browser pipeline:
 * - collectScoredWords (token combination: katakana chains, kanji merge, kanji+hira+kanji)
 * - term-filter (affix, inflection, function word, noise rejection)
 * - rankAndDedup (confidence-based ranking, fragment suppression)
 *
 * Usage: npx tsx scripts/test-ocr-accuracy.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { createWorker, type Worker } from 'tesseract.js';
import {
  shouldRejectExtractedTerm,
  getExtractedTermRejectionReason,
} from '../src/lib/ocr/term-filter';

// ---------- Constants (mirrored from tesseract.ts) ----------

const MAX_WORDS_PER_IMAGE = 50;
const JAPANESE_CHAR_REGEX = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\u3400-\u4DBF]/;
const JAPANESE_WORD_REGEX = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\u3400-\u4DBF]+/g;
const KANJI_REGEX = /[\u4E00-\u9FFF\u3400-\u4DBF]/;
const SINGLE_KANJI_REGEX = /^[\u4E00-\u9FFF\u3400-\u4DBF]$/;
const HIRAGANA_ONLY_REGEX = /^[\u3040-\u309F]+$/;
const KATAKANA_ONLY_REGEX = /^[\u30A0-\u30FF]+$/;

// ---------- Types ----------

interface ScoredWord {
  text: string;
  confidence: number;
}

interface RecognizeData {
  blocks?: Array<{
    paragraphs: Array<{
      lines: Array<{
        words: Array<{ text: string; confidence: number }>;
      }>;
    }>;
  }>;
}

interface OcrVariant {
  id: string;
  buffer: Buffer;
  weight: number;
}

interface TestCase {
  file: string;
  type: string;
  expected: string[];
}

interface TestResult {
  file: string;
  type: string;
  extracted: string[];
  expected: string[];
  matches: string[];
  misses: string[];
  noise: string[];
  precision: number;
  recall: number;
  f1: number;
}

// ---------- Ground Truth ----------

const TEST_CASES: TestCase[] = [
  {
    file: 'CleanShot_2026-02-26_00.31.09.png',
    type: 'Korean Wikipedia (dark bg)',
    expected: ['火山', '鍛冶', '武器', '神話', '祭日', '創作', '彫刻'],
  },
  {
    file: 'CleanShot_2026-02-26_00.31.36.png',
    type: 'Japanese website (low res)',
    expected: ['鉄道', '風景', '世界', '走行', '音楽'],
  },
  {
    file: 'B72DAD0A-FF28-436B-A985-12D76B96EF9E_1_105_c.jpeg',
    type: 'Anime profiles (clean)',
    expected: [
      '店長', '結束バンド', '虹夏', '性格', '経験', 'アドバイス', '人物',
      'ライブハウス', '音響', 'エンジニア', 'ピアス', '雰囲気', '初対面', '人柄', 'ツッコミ',
    ],
  },
  {
    file: '528B478B-C16E-46A0-A3D7-5ECA93494C61_1_105_c.jpeg',
    type: 'Sake menu (vertical)',
    expected: [
      '亀の海', '純米吟醸', '原酒', '信州', '山恵錦', 'フレッシュ', 'フルーティー',
      '北信流', '金紋錦', '五岳', '透明感', '御湖鶴', '奥信濃',
    ],
  },
  {
    file: 'CleanShot_2026-02-22_05.41.23.png',
    type: 'News listing (clean digital)',
    expected: [
      '新着情報', '静岡県', '富士山', '世界遺産', '絶景', '秀景', '写真',
      'コンテスト', '入賞', '作品展', '開催', '御朱印', '御城印', '紹介',
      'おすすめ', 'スポット', '雄大', 'クルーズ', '駿河湾', 'フェリー',
      '魅力', '解剖', '航路', '散歩',
    ],
  },
  {
    file: 'IMG_4364.jpeg',
    type: 'Sushi menu (vertical, handwritten-style)',
    expected: [
      '先付', '白菜', 'キノコ', '吸物', 'はまぐり', '刺身', '中トロ',
      'ブリ', '鰆', '昆布', '焼物', 'いくら', '茶碗蒸し', '揚物',
      '鮨', 'かわはぎ', 'うに', 'あら汁',
    ],
  },
  {
    file: 'IMG_9351.jpeg',
    type: 'Historical sign (outdoor, dark bg)',
    expected: [
      '入山宿', '江戸時代', '幕府', '街道', '繁栄', '利用', '明治',
      '大正', '宿場', '旅籠', '復元', '建築', '自然歩道',
    ],
  },
];

// ---------- Image Preprocessing (Node.js with sharp) ----------

async function isDarkBackgroundSharp(imagePath: string): Promise<boolean> {
  const stats = await sharp(readFileSync(imagePath))
    .resize({ width: 256, height: 256, fit: 'inside' })
    .grayscale()
    .stats();
  // stats.channels[0].mean is the mean brightness (0-255) for grayscale
  return stats.channels[0].mean < 128;
}

async function buildOcrVariantsNode(imagePath: string): Promise<OcrVariant[]> {
  const buf = readFileSync(imagePath);
  const variants: OcrVariant[] = [];

  // 1. Original (resize to max 2048px for consistency)
  const originalBuf = await sharp(buf)
    .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 90 })
    .toBuffer();
  variants.push({ id: 'original', buffer: originalBuf, weight: 1.0 });

  // 2. Grayscale + contrast (mirrors browser grayscale(100%) contrast(140%))
  const grayscaleBuf = await sharp(buf)
    .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
    .grayscale()
    .linear(1.4, 0)
    .jpeg({ quality: 90 })
    .toBuffer();
  variants.push({ id: 'grayscaleContrast', buffer: grayscaleBuf, weight: 0.92 });

  // 3. Threshold (Otsu-like: mean-based binarization)
  const rawPixels = await sharp(buf)
    .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { data: pixels, info } = rawPixels;
  let sum = 0;
  const pixelCount = info.width * info.height;
  const channels = info.channels;
  for (let i = 0; i < pixelCount; i++) {
    const offset = i * channels;
    const gray = 0.299 * pixels[offset] + 0.587 * pixels[offset + 1] + 0.114 * pixels[offset + 2];
    sum += gray;
  }
  const threshold = sum / pixelCount;

  const binaryBuf = Buffer.alloc(pixelCount * channels);
  for (let i = 0; i < pixelCount; i++) {
    const offset = i * channels;
    const gray = 0.299 * pixels[offset] + 0.587 * pixels[offset + 1] + 0.114 * pixels[offset + 2];
    const value = gray >= threshold ? 255 : 0;
    binaryBuf[offset] = value;
    binaryBuf[offset + 1] = value;
    binaryBuf[offset + 2] = value;
    if (channels === 4) binaryBuf[offset + 3] = pixels[offset + 3];
  }

  const thresholdBuf = await sharp(binaryBuf, {
    raw: { width: info.width, height: info.height, channels: info.channels },
  })
    .jpeg({ quality: 90 })
    .toBuffer();
  variants.push({ id: 'threshold', buffer: thresholdBuf, weight: 0.88 });

  // 4. Rotated 90 degrees CCW (for vertical Japanese text)
  // Japanese vertical text reads top-to-bottom, right-to-left, so CCW rotation
  // converts it to the left-to-right horizontal layout that Tesseract expects.
  const rotatedBuf = await sharp(buf)
    .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
    .rotate(-90)
    .jpeg({ quality: 90 })
    .toBuffer();
  variants.push({ id: 'rotatedCCW', buffer: rotatedBuf, weight: 0.85 });

  // 5. Rotated 90 degrees CW (some images need this direction)
  const rotatedCWBuf = await sharp(buf)
    .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
    .rotate(90)
    .jpeg({ quality: 90 })
    .toBuffer();
  variants.push({ id: 'rotatedCW', buffer: rotatedCWBuf, weight: 0.83 });

  // 6. Inverted (for dark background images) — only if actually dark
  const isDark = await isDarkBackgroundSharp(imagePath);
  if (isDark) {
    const invertedBuf = await sharp(buf)
      .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
      .grayscale()
      .negate()
      .normalize()
      .sharpen({ sigma: 1.5 })
      .jpeg({ quality: 90 })
      .toBuffer();
    variants.push({ id: 'inverted', buffer: invertedBuf, weight: 0.82 });

    // 7. Inverted + rotated CCW (for dark bg vertical text like historical signs)
    const invertedRotatedBuf = await sharp(buf)
      .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
      .grayscale()
      .negate()
      .normalize()
      .sharpen({ sigma: 1.5 })
      .rotate(-90)
      .jpeg({ quality: 90 })
      .toBuffer();
    variants.push({ id: 'invertedRotatedCCW', buffer: invertedRotatedBuf, weight: 0.78 });
  }

  return variants;
}

// ---------- Token combination (mirrored from updated tesseract.ts) ----------

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

        // Combine adjacent single-kanji tokens
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

        // Combine kanji + short hiragana chunks
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

// ---------- Rank and Dedup (mirrored from tesseract.ts) ----------

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

function rankAndDedup(words: ScoredWord[]): string[] {
  const best = new Map<string, number>();
  for (const w of words) {
    const prev = best.get(w.text);
    if (prev === undefined || w.confidence > prev) {
      best.set(w.text, w.confidence);
    }
  }

  const entries = [...best.entries()].filter(
    ([text]) => (text.length >= 2 || KANJI_REGEX.test(text)) && !shouldRejectExtractedTerm(text),
  );

  const tokenSet = new Set(entries.map(([text]) => text));
  const compactEntries = entries.filter(([text]) => !shouldSuppressFragmentToken(text, tokenSet));

  compactEntries.sort(([aText, aConf], [bText, bConf]) => {
    if (bConf !== aConf) return bConf - aConf;
    const aKanji = KANJI_REGEX.test(aText) ? 1 : 0;
    const bKanji = KANJI_REGEX.test(bText) ? 1 : 0;
    if (bKanji !== aKanji) return bKanji - aKanji;
    return bText.length - aText.length;
  });

  return compactEntries.slice(0, MAX_WORDS_PER_IMAGE).map(([text]) => text);
}

// ---------- Matching Logic ----------

function matchExpected(extracted: string[], expected: string[]): {
  matches: string[];
  misses: string[];
  noise: string[];
} {
  const matches: string[] = [];
  const misses: string[] = [];

  for (const exp of expected) {
    // Exact match or substring containment (either direction)
    const found = extracted.some(
      (ext) => ext === exp || ext.includes(exp) || exp.includes(ext),
    );
    if (found) {
      matches.push(exp);
    } else {
      misses.push(exp);
    }
  }

  // Noise: extracted words that don't match any expected word
  const noise = extracted.filter(
    (ext) => !expected.some((exp) => ext === exp || ext.includes(exp) || exp.includes(ext)),
  );

  return { matches, misses, noise };
}

function computeMetrics(matches: number, extracted: number, expected: number) {
  const precision = extracted > 0 ? matches / extracted : 0;
  const recall = expected > 0 ? matches / expected : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  return { precision, recall, f1 };
}

// ---------- Main ----------

async function main() {
  const testImgDir = resolve(__dirname, '../_docs/ocr/test-img');
  const results: TestResult[] = [];

  console.log('=== OCR Accuracy Test ===\n');
  console.log('Creating Tesseract worker...');

  // Create a single worker, reuse across images
  const worker: Worker = await createWorker('jpn');

  try {
    for (const testCase of TEST_CASES) {
      const imagePath = resolve(testImgDir, testCase.file);
      console.log(`\n--- [${testCase.type}] ${testCase.file} ---`);

      const variants = await buildOcrVariantsNode(imagePath);
      const allScoredWords: ScoredWord[] = [];

      for (const variant of variants) {
        const { data } = await worker.recognize(variant.buffer, {}, { blocks: true });
        const scored = collectScoredWords(data as RecognizeData, variant.weight);
        allScoredWords.push(...scored);
        console.log(`  Variant "${variant.id}": ${scored.length} raw tokens`);
      }

      const extracted = rankAndDedup(allScoredWords);
      const { matches, misses, noise } = matchExpected(extracted, testCase.expected);
      const { precision, recall, f1 } = computeMetrics(
        matches.length,
        extracted.length,
        testCase.expected.length,
      );

      console.log(`  Extracted (${extracted.length}): ${extracted.join(', ')}`);
      console.log(`  Expected  (${testCase.expected.length}): ${testCase.expected.join(', ')}`);
      console.log(`  Matches   (${matches.length}): ${matches.join(', ')}`);
      console.log(`  Misses    (${misses.length}): ${misses.join(', ')}`);
      console.log(`  Noise     (${noise.length}): ${noise.join(', ')}`);
      console.log(`  Precision: ${(precision * 100).toFixed(1)}% | Recall: ${(recall * 100).toFixed(1)}% | F1: ${(f1 * 100).toFixed(1)}%`);

      results.push({
        file: testCase.file,
        type: testCase.type,
        extracted,
        expected: testCase.expected,
        matches,
        misses,
        noise,
        precision,
        recall,
        f1,
      });
    }
  } finally {
    await worker.terminate();
  }

  // ---------- Overall Summary ----------
  console.log('\n\n========================================');
  console.log('           OVERALL SUMMARY');
  console.log('========================================\n');

  let totalMatches = 0;
  let totalExtracted = 0;
  let totalExpected = 0;

  for (const r of results) {
    totalMatches += r.matches.length;
    totalExtracted += r.extracted.length;
    totalExpected += r.expected.length;
    console.log(
      `${r.type.padEnd(40)} P=${(r.precision * 100).toFixed(0).padStart(3)}%  R=${(r.recall * 100).toFixed(0).padStart(3)}%  F1=${(r.f1 * 100).toFixed(0).padStart(3)}%  (${r.matches.length}/${r.expected.length} found, ${r.noise.length} noise)`,
    );
  }

  const overall = computeMetrics(totalMatches, totalExtracted, totalExpected);
  console.log('');
  console.log(`${'OVERALL'.padEnd(40)} P=${(overall.precision * 100).toFixed(0).padStart(3)}%  R=${(overall.recall * 100).toFixed(0).padStart(3)}%  F1=${(overall.f1 * 100).toFixed(0).padStart(3)}%  (${totalMatches}/${totalExpected} found)`);
  console.log('');

  // Identify worst performers
  const byRecall = [...results].sort((a, b) => a.recall - b.recall);
  const byPrecision = [...results].sort((a, b) => a.precision - b.precision);
  console.log('Worst recall:    ' + byRecall[0].type + ` (${(byRecall[0].recall * 100).toFixed(0)}%)`);
  console.log('Worst precision: ' + byPrecision[0].type + ` (${(byPrecision[0].precision * 100).toFixed(0)}%)`);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
