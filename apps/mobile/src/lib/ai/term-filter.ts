const PREFIX_ONLY_TERMS = new Set(['お', 'ご', '未', '非', '無', '再', '超', '第']);
const SUFFIX_ONLY_TERMS = new Set(['的', '性', '化', '力', '者']);
const INFLECTION_ONLY_TERMS = new Set([
  'ます',
  'ました',
  'ません',
  'ましょう',
  'ない',
  'なかった',
  'たい',
  'たく',
  'たかった',
  'れる',
  'られる',
  'せる',
  'させる',
  'した',
  'して',
  'する',
  'だった',
  'です',
  'である',
  'だ',
  'た',
]);

/** Common function words / particles that are not useful as vocabulary terms. */
const FUNCTION_WORD_TERMS = new Set([
  // Pronouns / demonstratives
  'こと', 'もの', 'ため', 'ところ', 'よう', 'ほう', 'ほど',
  'いう', 'その', 'この', 'あの', 'どの',
  'ここ', 'そこ', 'あそこ', 'どこ',
  'それ', 'これ', 'あれ', 'どれ',
  // Basic verbs
  'ある', 'いる', 'なる', 'おる', 'いく', 'くる', 'みる', 'でる', 'おく',
  'もつ', 'だす', '出す', '作る', '言う', '行く', '来る', '見る',
  // Basic adjectives
  'ない', 'よい', 'いい', '多い', '良い', '新しい', '美しい', '大きい', '小さい', '長い',
  // Connectors / conjunctions
  'から', 'まで', 'など', 'ほか', 'ただ',
  'また', 'もう', 'まだ', 'もし', 'さて', 'つまり',
  'けど', 'けれど', 'ので', 'のに', 'ながら', 'つつ',
  // Common inflection fragments / particles
  'ける', 'える', 'ませ', 'きれ', 'えて', 'あっ', 'おき',
  'いま', 'とき', 'たび', 'つい', 'よく', 'すぐ',
  // Common short hiragana that are almost always OCR noise
  'さん', 'くさ', 'きす', 'まる', 'ぶっ', 'もい', 'こね', 'そる',
  'はい', 'ちる', 'にゃ', 'りら', 'ざさ', 'いわ', 'きり', 'くい',
  'づつ', 'こっ', 'かす', 'いこ',
]);

const KATAKANA_ONLY_REGEX = /^[\u30A0-\u30FF]+$/;
const LONG_SOUND_ONLY_REGEX = /^[ーｰ]+$/;
const REPEATED_CHAR_ONLY_REGEX = /^(.)\1+$/u;
const KANJI_REGEX = /^[\u4E00-\u9FFF\u3400-\u4DBF]$/;
const AFFIX_MARKS_CLASS = '[~～〜\\-ーｰ・･·.]';
const MARK_CHAR_REGEX = /[~～〜\-ーｰ・･·.]/g;
const MARK_CHAR_ANY_REGEX = /[~～〜\-ーｰ・･·.]/;
const LEADING_MARKS_REGEX = new RegExp(`^${AFFIX_MARKS_CLASS}+`);
const TRAILING_MARKS_REGEX = new RegExp(`${AFFIX_MARKS_CLASS}+$`);
const PREFIX_LIKE_TRAILING_MARK_REGEX = new RegExp(`^[\\u4E00-\\u9FFF\\u3400-\\u4DBF]${AFFIX_MARKS_CLASS}+$`);
const SUFFIX_LIKE_LEADING_MARK_REGEX = new RegExp(`^${AFFIX_MARKS_CLASS}+[\\u4E00-\\u9FFF\\u3400-\\u4DBF]$`);

/**
 * Regex matching any Japanese character (kanji, hiragana, katakana).
 * Used to validate that a term actually contains Japanese text.
 */
const JAPANESE_CHAR_REGEX = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\u3400-\u4DBF]/;

/**
 * Regex matching hiragana-only strings.
 * Used to validate that a reading is pure hiragana.
 */
const HIRAGANA_ONLY_REGEX = /^[\u3040-\u309F\u30FC]+$/;

export type RejectionReason =
  | 'empty'
  | 'no_japanese'
  | 'affix_only'
  | 'inflection_only'
  | 'function_word'
  | 'noise_pattern';

function normalizeTerm(term: string): string {
  return term
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, '');
}

function isAffixOnly(term: string): boolean {
  return PREFIX_ONLY_TERMS.has(term) || SUFFIX_ONLY_TERMS.has(term);
}

function isInflectionOnly(term: string): boolean {
  return INFLECTION_ONLY_TERMS.has(term);
}

/**
 * Regex matching へ repeated — a very common OCR artifact from vertical text misreads.
 * Matches patterns like 人へへ, 和合へへ, 到へへ etc.
 */
const HE_REPEATED_REGEX = /へ{2,}/;

/**
 * Regex matching tokens that are mostly a single character repeated.
 * E.g., 回回口, ンジジジ, 池きき — OCR artifacts from vertical text.
 */
const DOMINANT_CHAR_REGEX = /^(.)(.*)\1{2,}|^(.)\3{2,}/u;

/**
 * Detects tokens where unique character count is very low relative to length —
 * a hallmark of OCR gibberish (e.g., 回問回回, ンジンジ, ドドドキ).
 */
function hasLowCharDiversity(term: string): boolean {
  if (term.length < 4) return false;
  const unique = new Set(term);
  // If less than 40% of chars are unique, it's likely garbage
  return unique.size / term.length < 0.4;
}

/**
 * Detects tokens that mix hiragana particles with kanji in a way that suggests
 * OCR misjoining (e.g., 府まこ, 人るこ, 鶴にの, 枯にて).
 */
const KANJI_PARTICLE_MIX_REGEX = /^[\u4E00-\u9FFF\u3400-\u4DBF][\u3040-\u309F]{1,2}[\u4E00-\u9FFF\u3400-\u4DBF\u3040-\u309F]$/;
const SHORT_PARTICLE_SUFFIX_REGEX = /^[\u4E00-\u9FFF\u3400-\u4DBF]{1,2}[をにでがはもへとのや]$/;

/**
 * Detects verb/adjective phrases attached to kanji — OCR artifacts from sentence fragments.
 * E.g., 表現され, 描写され, 意味する, 登場する, 信仰され, 投稿し, 作曲し
 * Also catches kanji + し (masu-stem, e.g. 投稿し, 作曲し, 感謝し)
 */
const VERB_PHRASE_SUFFIX_REGEX = /[\u4E00-\u9FFF\u3400-\u4DBF](する|される|され|して|した|しい|せる|させ|せた|させた|しく|しか|しも|しを|って|った|っている|わっ|れる|せて)$/;
/**
 * Specifically matches 2-kanji + し (masu-stem verb fragments like 投稿し, 作曲し, 感謝し).
 * Only matches exactly 3-char terms to avoid rejecting nouns ending in し (e.g., 茶碗蒸し).
 */
const KANJI_MASU_STEM_REGEX = /^[\u4E00-\u9FFF\u3400-\u4DBF]{2}し$/;
/**
 * Detects terms ending with a particle directly after kanji/katakana.
 * E.g., 火山を, 動画を, 景色や — these are sentence fragments, not standalone terms.
 */
const PARTICLE_ENDING_REGEX = /[\u4E00-\u9FFF\u3400-\u4DBF\u30A0-\u30FF](を|に|で|が|は|も|へ|と|の|や|な|から|まで|より|など|って|ので|けど|のに)$/;
/**
 * Detects compound fragments with particles in the middle.
 * E.g., 景色や公共, 動画を投稿, 企画を敢行, 機関に関連
 * Pattern: kanji + particle + kanji (total 4+ chars)
 * Note: の is excluded since it legitimately connects compound nouns (e.g., 亀の海).
 */
const MID_PARTICLE_COMPOUND_REGEX = /[\u4E00-\u9FFF\u3400-\u4DBF](を|に|で|が|は|も|へ|と|や)[\u4E00-\u9FFF\u3400-\u4DBF]/;

function isLikelyNoiseToken(term: string): boolean {
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

  // --- New noise patterns ---

  // Repeated へ is a very common vertical-text OCR artifact
  if (HE_REPEATED_REGEX.test(term)) return true;

  // Low character diversity (e.g., 回問回回, ンジンジ, ドドドキ)
  if (hasLowCharDiversity(term)) return true;

  // Dominant repeated character (e.g., ンジジジ, 移いいいい)
  if (DOMINANT_CHAR_REGEX.test(term) && term.length >= 4) return true;

  // Kanji + single particle suffix (e.g., 武器を, 火山を, 防具を) — these are fragments, not terms
  if (SHORT_PARTICLE_SUFFIX_REGEX.test(term)) return true;

  // Kanji-particle-kanji/kana mixes from OCR misjoining (e.g., 府まこ, 人るこ)
  if (KANJI_PARTICLE_MIX_REGEX.test(term) && term.length <= 4) return true;

  // Function words
  if (FUNCTION_WORD_TERMS.has(term)) return true;

  // Note: we intentionally do NOT blanket-reject all 2-char hiragana/katakana because
  // some are valid vocabulary (e.g., うに, ブリ). Downstream dictionary enrichment handles this.

  // Verb/adjective phrases attached to kanji (e.g., 表現され, 意味する)
  if (VERB_PHRASE_SUFFIX_REGEX.test(term) && term.length >= 3) return true;

  // 2-kanji + し masu-stem (e.g., 投稿し, 作曲し, 感謝し)
  if (KANJI_MASU_STEM_REGEX.test(term)) return true;

  // Terms ending with particles (e.g., 景色や, 動画を, 企画を)
  if (PARTICLE_ENDING_REGEX.test(term) && term.length >= 3) return true;

  // Compound fragments with particles in the middle (e.g., 景色や公共, 動画を投稿)
  if (MID_PARTICLE_COMPOUND_REGEX.test(term) && term.length >= 4) return true;

  return false;
}

export function shouldRejectExtractedTerm(rawTerm: string): boolean {
  return getExtractedTermRejectionReason(rawTerm) !== null;
}

export function getExtractedTermRejectionReason(rawTerm: string): RejectionReason | null {
  const term = normalizeTerm(rawTerm);
  if (!term) return 'empty';
  if (!JAPANESE_CHAR_REGEX.test(term)) return 'no_japanese';
  // Single kanji is always allowed (it is a valid vocabulary unit).
  if (KANJI_REGEX.test(term)) return null;
  if (isAffixOnly(term)) return 'affix_only';
  if (isInflectionOnly(term)) return 'inflection_only';
  // Function words are checked before noise so we get a more specific reason.
  if (FUNCTION_WORD_TERMS.has(term)) return 'function_word';
  if (isLikelyNoiseToken(term)) return 'noise_pattern';
  return null;
}

export function normalizeExtractedTerm(rawTerm: string): string {
  return normalizeTerm(rawTerm);
}

export function hasMarkChars(term: string): boolean {
  return MARK_CHAR_ANY_REGEX.test(term);
}

/** Returns true if the reading contains only hiragana (and prolonged sound mark). */
export function isValidReading(reading: string): boolean {
  const normalized = normalizeTerm(reading);
  if (!normalized) return false;
  return HIRAGANA_ONLY_REGEX.test(normalized);
}

/** Returns true if the term contains at least one Japanese character. */
export function containsJapanese(term: string): boolean {
  return JAPANESE_CHAR_REGEX.test(term);
}
