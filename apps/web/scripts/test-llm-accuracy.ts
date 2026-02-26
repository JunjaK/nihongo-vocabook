/**
 * LLM Vision OCR accuracy test script.
 *
 * Reads test images from _docs/ocr/test-img/, sends them to an LLM provider
 * (OpenAI or Anthropic), and compares extracted words against expected ground truth.
 *
 * Usage:
 *   npx tsx scripts/test-llm-accuracy.ts
 *   npx tsx scripts/test-llm-accuracy.ts --provider=anthropic
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ExtractedWord {
  term: string;
  reading: string;
  meaning: string;
  jlptLevel: number | null;
}

interface TestCase {
  file: string;
  label: string;
  expectedWords: string[];
}

interface TestResult {
  testCase: TestCase;
  extracted: ExtractedWord[];
  matches: string[];
  misses: string[];
  falsePositives: string[];
  precision: number;
  recall: number;
  f1: number;
  durationMs: number;
}

type Provider = 'openai' | 'anthropic';

// ---------------------------------------------------------------------------
// Load env from .env.local
// ---------------------------------------------------------------------------

function loadEnv(): void {
  const envPath = resolve(__dirname, '..', '.env.local');
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx);
    const val = trimmed.slice(eqIdx + 1);
    if (!process.env[key]) {
      process.env[key] = val;
    }
  }
}

loadEnv();

// ---------------------------------------------------------------------------
// Term filter (standalone copy from src/lib/ocr/term-filter.ts)
// ---------------------------------------------------------------------------

const PREFIX_ONLY_TERMS = new Set(['お', 'ご', '未', '非', '無', '再', '超', '第']);
const SUFFIX_ONLY_TERMS = new Set(['的', '性', '化', '力', '者']);
const INFLECTION_ONLY_TERMS = new Set([
  'ます', 'ました', 'ません', 'ましょう',
  'ない', 'なかった', 'たい', 'たく', 'たかった',
  'れる', 'られる', 'せる', 'させる',
  'した', 'して', 'する', 'だった', 'です', 'である', 'だ', 'た',
]);

const FUNCTION_WORD_TERMS = new Set([
  'こと', 'もの', 'ため', 'ところ', 'よう', 'ほう', 'ほど',
  'ある', 'いる', 'なる', 'おる', 'いく', 'くる',
  'から', 'まで', 'など', 'ほか', 'ただ',
  'いう', 'その', 'この', 'あの', 'どの',
  'ここ', 'そこ', 'あそこ', 'どこ',
  'それ', 'これ', 'あれ', 'どれ',
  'ない', 'よい', 'いい',
  'また', 'もう', 'まだ', 'もし', 'さて', 'つまり',
  'けど', 'けれど', 'ので', 'のに', 'ながら', 'つつ',
  'ける', 'える', 'ませ', 'きれ', 'えて', 'あっ', 'おき',
  'いま', 'とき', 'たび',
]);

const KATAKANA_ONLY_REGEX = /^[\u30A0-\u30FF]+$/;
const LONG_SOUND_ONLY_REGEX = /^[ーｰ]+$/;
const REPEATED_CHAR_ONLY_REGEX = /^(.)\1+$/u;
const KANJI_REGEX = /^[\u4E00-\u9FFF\u3400-\u4DBF]$/;
const JAPANESE_CHAR_REGEX = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\u3400-\u4DBF]/;
const AFFIX_MARKS_CLASS = '[~～〜\\-ーｰ・･·.]';
const MARK_CHAR_REGEX = /[~～〜\-ーｰ・･·.]/g;
const LEADING_MARKS_REGEX = new RegExp(`^${AFFIX_MARKS_CLASS}+`);
const TRAILING_MARKS_REGEX = new RegExp(`${AFFIX_MARKS_CLASS}+$`);
const PREFIX_LIKE_TRAILING_MARK_REGEX = new RegExp(`^[\\u4E00-\\u9FFF\\u3400-\\u4DBF]${AFFIX_MARKS_CLASS}+$`);
const SUFFIX_LIKE_LEADING_MARK_REGEX = new RegExp(`^${AFFIX_MARKS_CLASS}+[\\u4E00-\\u9FFF\\u3400-\\u4DBF]$`);
const HE_REPEATED_REGEX = /へ{2,}/;
const DOMINANT_CHAR_REGEX = /^(.)(.*)\1{2,}|^(.)\3{2,}/u;
const SHORT_PARTICLE_SUFFIX_REGEX = /^[\u4E00-\u9FFF\u3400-\u4DBF]{1,2}[をにでがはもへとのや]$/;
const KANJI_PARTICLE_MIX_REGEX = /^[\u4E00-\u9FFF\u3400-\u4DBF][\u3040-\u309F]{1,2}[\u4E00-\u9FFF\u3400-\u4DBF\u3040-\u309F]$/;

function normalizeTerm(term: string): string {
  return term.normalize('NFKC').trim().replace(/\s+/g, '');
}

function hasLowCharDiversity(term: string): boolean {
  if (term.length < 4) return false;
  const unique = new Set(term);
  return unique.size / term.length < 0.4;
}

function shouldRejectExtractedTerm(rawTerm: string): boolean {
  const term = normalizeTerm(rawTerm);
  if (!term) return true;
  if (!JAPANESE_CHAR_REGEX.test(term)) return true;
  if (KANJI_REGEX.test(term)) return false;
  if (PREFIX_ONLY_TERMS.has(term) || SUFFIX_ONLY_TERMS.has(term)) return true;
  if (INFLECTION_ONLY_TERMS.has(term)) return true;
  // noise patterns
  if (LONG_SOUND_ONLY_REGEX.test(term)) return true;
  if (REPEATED_CHAR_ONLY_REGEX.test(term) && term.length >= 2) return true;
  if (PREFIX_LIKE_TRAILING_MARK_REGEX.test(term)) return true;
  if (SUFFIX_LIKE_LEADING_MARK_REGEX.test(term)) return true;
  const markCount = (term.match(MARK_CHAR_REGEX) ?? []).length;
  if (markCount >= 2) return true;
  if ((LEADING_MARKS_REGEX.test(term) || TRAILING_MARKS_REGEX.test(term)) && markCount >= 1) {
    const stripped = term.replace(MARK_CHAR_REGEX, '');
    if (stripped.length <= 4) return true;
    if (KATAKANA_ONLY_REGEX.test(stripped)) return true;
  }
  if (KATAKANA_ONLY_REGEX.test(term)) {
    if (term.length <= 2 && term.endsWith('ー')) return true;
    if (term.length === 2 && term[0] === term[1]) return true;
  }
  // Additional noise patterns
  if (HE_REPEATED_REGEX.test(term)) return true;
  if (hasLowCharDiversity(term)) return true;
  if (DOMINANT_CHAR_REGEX.test(term) && term.length >= 4) return true;
  if (SHORT_PARTICLE_SUFFIX_REGEX.test(term)) return true;
  if (KANJI_PARTICLE_MIX_REGEX.test(term) && term.length <= 4) return true;
  if (FUNCTION_WORD_TERMS.has(term)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// System prompt (copy from route.ts)
// ---------------------------------------------------------------------------

function buildSystemPrompt(locale: string): string {
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

// ---------------------------------------------------------------------------
// JSON array parser (copy from route.ts)
// ---------------------------------------------------------------------------

function parseJsonArray(content: string): ExtractedWord[] {
  const jsonMatch = content.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];

  const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>[];
  const seen = new Set<string>();

  return parsed
    .filter(
      (w) => typeof w.term === 'string' && typeof w.reading === 'string' && typeof w.meaning === 'string',
    )
    .map((w) => {
      const term = normalizeTerm(w.term as string);
      const level = typeof w.jlptLevel === 'number' && w.jlptLevel >= 1 && w.jlptLevel <= 5
        ? w.jlptLevel
        : null;
      return { term, reading: w.reading as string, meaning: w.meaning as string, jlptLevel: level };
    })
    .filter((word) => !shouldRejectExtractedTerm(word.term))
    .filter((word) => {
      if (seen.has(word.term)) return false;
      seen.add(word.term);
      return true;
    });
}

// ---------------------------------------------------------------------------
// Data URL helpers
// ---------------------------------------------------------------------------

function parseDataUrl(dataUrl: string): { mediaType: string; base64Data: string } {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (match) return { mediaType: match[1], base64Data: match[2] };
  return { mediaType: 'image/jpeg', base64Data: dataUrl };
}

function imageToDataUrl(filePath: string): string {
  const buf = readFileSync(filePath);
  const ext = extname(filePath).toLowerCase();
  let mime = 'image/jpeg';
  if (ext === '.png') mime = 'image/png';
  else if (ext === '.webp') mime = 'image/webp';
  return `data:${mime};base64,${buf.toString('base64')}`;
}

// ---------------------------------------------------------------------------
// Provider calls
// ---------------------------------------------------------------------------

async function callOpenAI(apiKey: string, imageBase64: string, locale: string): Promise<ExtractedWord[]> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: buildSystemPrompt(locale) },
            { type: 'image_url', image_url: { url: imageBase64 } },
          ],
        },
      ],
      max_tokens: 4096,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI API error (${res.status}): ${err}`);
  }

  const data = await res.json();
  const content: string = data.choices[0]?.message?.content ?? '[]';
  return parseJsonArray(content);
}

async function callAnthropic(apiKey: string, imageBase64: string, locale: string): Promise<ExtractedWord[]> {
  const { mediaType, base64Data } = parseDataUrl(imageBase64);

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: base64Data },
            },
            { type: 'text', text: buildSystemPrompt(locale) },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic API error (${res.status}): ${err}`);
  }

  const data = await res.json();
  const textBlock = data.content?.find((b: { type: string }) => b.type === 'text');
  const content: string = textBlock?.text ?? '[]';
  return parseJsonArray(content);
}

// ---------------------------------------------------------------------------
// Test case definitions
// ---------------------------------------------------------------------------

const TEST_IMG_DIR = resolve(__dirname, '../../../_docs/ocr/test-img');

const TEST_CASES: TestCase[] = [
  {
    file: 'CleanShot_2026-02-26_00.31.09.png',
    label: '#1 Korean Wikipedia (dark bg, mixed Korean/Japanese)',
    expectedWords: ['火山', '鍛冶', '武器', '神話', '祭日', '創作', '彫刻'],
  },
  {
    file: 'CleanShot_2026-02-26_00.31.36.png',
    label: '#2 Japanese website (low res)',
    expectedWords: ['鉄道', '風景', '世界', '走行', '音楽'],
  },
  {
    file: 'B72DAD0A-FF28-436B-A985-12D76B96EF9E_1_105_c.jpeg',
    label: '#3 Anime profiles (clean)',
    expectedWords: ['店長', '結束バンド', '虹夏', '性格', '経験', 'アドバイス', '人物', 'ライブハウス', '音響', 'エンジニア', 'ピアス', '雰囲気', '初対面', '人柄', 'ツッコミ'],
  },
  {
    file: '528B478B-C16E-46A0-A3D7-5ECA93494C61_1_105_c.jpeg',
    label: '#4 Sake menu (vertical)',
    expectedWords: ['亀の海', '純米吟醸', '原酒', '信州', '山恵錦', 'フレッシュ', 'フルーティー', '北信流', '金紋錦', '五岳', '透明感', '御湖鶴', '奥信濃'],
  },
  {
    file: 'CleanShot_2026-02-22_05.41.23.png',
    label: '#5 News listing (clean digital)',
    expectedWords: ['新着情報', '静岡県', '富士山', '世界遺産', '絶景', '秀景', '写真', 'コンテスト', '入賞', '作品展', '開催', '御朱印', '御城印', '紹介', 'おすすめ', 'スポット', '雄大', 'クルーズ', '駿河湾', 'フェリー', '魅力', '解剖', '航路', '散歩'],
  },
  {
    file: 'IMG_4364.jpeg',
    label: '#6 Sushi menu (vertical, handwritten-style)',
    expectedWords: ['先付', '白菜', 'キノコ', '吸物', 'はまぐり', '刺身', '中トロ', 'ブリ', '鰆', '昆布', '焼物', 'いくら', '茶碗蒸し', '揚物', '鮨', 'かわはぎ', 'うに', 'あら汁'],
  },
  {
    file: 'IMG_9351.jpeg',
    label: '#7 Historical sign (outdoor, dark bg)',
    expectedWords: ['入山宿', '江戸時代', '幕府', '街道', '繁栄', '利用', '明治', '大正', '宿場', '旅籠', '復元', '建築', '自然歩道'],
  },
];

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

function computeMetrics(
  extracted: ExtractedWord[],
  expected: string[],
): { matches: string[]; misses: string[]; falsePositives: string[]; precision: number; recall: number; f1: number } {
  const extractedTerms = new Set(extracted.map((w) => w.term));
  const expectedSet = new Set(expected);

  const matches: string[] = [];
  const misses: string[] = [];
  const falsePositives: string[] = [];

  // Check matches and misses
  for (const exp of expected) {
    // Exact match
    if (extractedTerms.has(exp)) {
      matches.push(exp);
      continue;
    }
    // Partial match: extracted term contains expected or vice versa
    let found = false;
    for (const ext of extractedTerms) {
      if (ext.includes(exp) || exp.includes(ext)) {
        matches.push(`${exp} (~${ext})`);
        found = true;
        break;
      }
    }
    if (!found) {
      misses.push(exp);
    }
  }

  // False positives: extracted terms not in expected set (exact or partial)
  for (const ext of extractedTerms) {
    let isExpected = false;
    for (const exp of expectedSet) {
      if (ext === exp || ext.includes(exp) || exp.includes(ext)) {
        isExpected = true;
        break;
      }
    }
    if (!isExpected) {
      falsePositives.push(ext);
    }
  }

  const precision = extractedTerms.size > 0 ? matches.length / extractedTerms.size : 0;
  const recall = expected.length > 0 ? matches.length / expected.length : 0;
  const f1 = precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0;

  return { matches, misses, falsePositives, precision, recall, f1 };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // Determine provider
  const args = process.argv.slice(2);
  const providerArg = args.find((a) => a.startsWith('--provider='))?.split('=')[1];

  let provider: Provider;
  let apiKey: string;

  const openaiKey = process.env.OPENAI_API_KEY ?? process.env.NEXT_PRIVATE_OPENAI_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  if (providerArg === 'anthropic' && anthropicKey) {
    provider = 'anthropic';
    apiKey = anthropicKey;
  } else if (providerArg === 'openai' && openaiKey) {
    provider = 'openai';
    apiKey = openaiKey;
  } else if (openaiKey) {
    provider = 'openai';
    apiKey = openaiKey;
  } else if (anthropicKey) {
    provider = 'anthropic';
    apiKey = anthropicKey;
  } else {
    console.error('ERROR: No API key found. Set OPENAI_API_KEY, NEXT_PRIVATE_OPENAI_API_KEY, or ANTHROPIC_API_KEY.');
    process.exit(1);
  }

  console.log(`\n${'='.repeat(70)}`);
  console.log(`LLM Vision OCR Accuracy Test`);
  console.log(`Provider: ${provider}`);
  console.log(`Test images: ${TEST_CASES.length}`);
  console.log(`${'='.repeat(70)}\n`);

  const results: TestResult[] = [];

  for (const tc of TEST_CASES) {
    const imgPath = resolve(TEST_IMG_DIR, tc.file);
    if (!existsSync(imgPath)) {
      console.log(`SKIP: ${tc.file} not found`);
      continue;
    }

    console.log(`\n--- ${tc.label} ---`);
    console.log(`File: ${tc.file}`);

    const dataUrl = imageToDataUrl(imgPath);
    const sizeMB = (readFileSync(imgPath).length / 1024 / 1024).toFixed(2);
    console.log(`Image size: ${sizeMB} MB`);

    const start = Date.now();
    let extracted: ExtractedWord[];
    try {
      if (provider === 'openai') {
        extracted = await callOpenAI(apiKey, dataUrl, 'ko');
      } else {
        extracted = await callAnthropic(apiKey, dataUrl, 'ko');
      }
    } catch (err) {
      console.error(`  ERROR: ${err instanceof Error ? err.message : err}`);
      continue;
    }
    const durationMs = Date.now() - start;

    console.log(`  Extracted ${extracted.length} words in ${durationMs}ms`);
    console.log(`  Terms: ${extracted.map((w) => w.term).join(', ')}`);

    const metrics = computeMetrics(extracted, tc.expectedWords);

    console.log(`\n  Expected (${tc.expectedWords.length}): ${tc.expectedWords.join(', ')}`);
    console.log(`  Matches  (${metrics.matches.length}): ${metrics.matches.join(', ')}`);
    console.log(`  Misses   (${metrics.misses.length}): ${metrics.misses.join(', ')}`);
    console.log(`  FP       (${metrics.falsePositives.length}): ${metrics.falsePositives.join(', ')}`);
    console.log(`  Precision: ${(metrics.precision * 100).toFixed(1)}%  Recall: ${(metrics.recall * 100).toFixed(1)}%  F1: ${(metrics.f1 * 100).toFixed(1)}%`);

    results.push({
      testCase: tc,
      extracted,
      ...metrics,
      durationMs,
    });
  }

  // Overall summary
  console.log(`\n\n${'='.repeat(70)}`);
  console.log('OVERALL SUMMARY');
  console.log(`${'='.repeat(70)}`);

  let totalMatches = 0;
  let totalExpected = 0;
  let totalExtracted = 0;

  for (const r of results) {
    totalMatches += r.matches.length;
    totalExpected += r.testCase.expectedWords.length;
    totalExtracted += r.extracted.length;
    console.log(`  ${r.testCase.label.padEnd(50)} P=${(r.precision * 100).toFixed(0).padStart(3)}%  R=${(r.recall * 100).toFixed(0).padStart(3)}%  F1=${(r.f1 * 100).toFixed(0).padStart(3)}%  (${r.matches.length}/${r.testCase.expectedWords.length} matched, ${r.falsePositives.length} FP)`);
  }

  const overallPrecision = totalExtracted > 0 ? totalMatches / totalExtracted : 0;
  const overallRecall = totalExpected > 0 ? totalMatches / totalExpected : 0;
  const overallF1 = overallPrecision + overallRecall > 0
    ? 2 * overallPrecision * overallRecall / (overallPrecision + overallRecall)
    : 0;

  console.log(`\n  OVERALL: P=${(overallPrecision * 100).toFixed(1)}%  R=${(overallRecall * 100).toFixed(1)}%  F1=${(overallF1 * 100).toFixed(1)}%`);
  console.log(`  Total: ${totalMatches} matches / ${totalExpected} expected / ${totalExtracted} extracted`);
  console.log(`${'='.repeat(70)}\n`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
