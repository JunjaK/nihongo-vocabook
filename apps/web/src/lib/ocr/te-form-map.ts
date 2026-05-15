/**
 * Curated te-form / ta-form → dictionary-form mapping for common Japanese verbs.
 *
 * Why curated (not algorithmic):
 *   Te-form / ta-form for 五段 verbs has a 1:N reverse mapping because the
 *   ending depends on the verb's base-form suffix:
 *     - 書く → 書いて        but 行く → 行って (irregular)
 *     - 読む → 読んで, 死ぬ → 死んで, 遊ぶ → 遊んで (all collapse to んで)
 *     - 待つ → 待って, 買う → 買って, 売る → 売って (all collapse to って)
 *   Recovering the right base form from `って` alone requires verb-class
 *   knowledge, which we don't have at lookup time. Curating a list of common
 *   verbs gives us zero false positives for the entries we list, at the cost
 *   of coverage for verbs not in the table.
 *
 * Scope:
 *   - 五段 verbs: top-frequency JLPT N5/N4 base forms by suffix class
 *   - 不規則: 行く / 来る / する with full te/ta variants
 *   - Stacked te-form: て + いる/いた/います/いました (te-iru family)
 *   - 一段 verbs are intentionally excluded — the algorithmic stripper in
 *     `scan-store.ts` already recovers 食べて → 食べる via the +る candidate.
 *
 * To extend: add base forms to GODAN_VERBS[suffix]. The map regenerates at
 * module load. See `_docs/active/scan-dictionary-fuzzy-match.md` § Te-form
 * addendum for the design rationale.
 */

type GodanSuffix = 'く' | 'ぐ' | 'す' | 'つ' | 'ぬ' | 'ぶ' | 'む' | 'う' | 'る';

interface Conjugation {
  te: string;
  ta: string;
}

const GODAN_CONJUGATIONS: Readonly<Record<GodanSuffix, Conjugation>> = {
  く: { te: 'いて', ta: 'いた' },
  ぐ: { te: 'いで', ta: 'いだ' },
  す: { te: 'して', ta: 'した' },
  つ: { te: 'って', ta: 'った' },
  ぬ: { te: 'んで', ta: 'んだ' },
  ぶ: { te: 'んで', ta: 'んだ' },
  む: { te: 'んで', ta: 'んだ' },
  う: { te: 'って', ta: 'った' },
  る: { te: 'って', ta: 'った' },
};

const GODAN_VERBS: Readonly<Record<GodanSuffix, readonly string[]>> = {
  く: ['書く', '聞く', '歩く', '働く', '着く', '開く', '泣く', '吹く', '咲く', '描く', '引く', '置く', '続く'],
  ぐ: ['泳ぐ', '急ぐ', '脱ぐ', '騒ぐ', '注ぐ'],
  す: ['話す', '出す', '押す', '貸す', '返す', '消す', '探す', '指す', '直す', '渡す', '示す', '残す'],
  つ: ['待つ', '持つ', '立つ', '勝つ', '打つ', '育つ'],
  ぬ: ['死ぬ'],
  ぶ: ['遊ぶ', '呼ぶ', '飛ぶ', '学ぶ', '並ぶ', '選ぶ', '喜ぶ', '結ぶ', '運ぶ'],
  む: ['読む', '飲む', '休む', '住む', '進む', '頼む', '挟む', '包む', '噛む', '組む', '済む'],
  う: ['買う', '会う', '言う', '思う', '使う', '歌う', '笑う', '払う', '習う', '洗う', '吸う', '違う'],
  る: ['取る', '作る', '売る', '帰る', '走る', '切る', '知る', '入る', '要る', '減る', '降る', '乗る', '渡る', '残る', '怒る'],
};

interface IrregularEntry {
  base: string;
  forms: readonly string[];
}

const IRREGULAR_VERBS: readonly IrregularEntry[] = [
  {
    base: '行く',
    forms: ['行って', '行った', 'いって', 'いった'],
  },
  {
    base: '来る',
    forms: ['来て', '来た', 'きて', 'きた'],
  },
  {
    base: 'する',
    forms: ['して', 'した'],
  },
];

const TE_STACKED_SUFFIXES: readonly string[] = [
  '', // bare te-form
  'いる',
  'いた',
  'います',
  'いました',
  'ください',
];

const TA_STACKED_SUFFIXES: readonly string[] = [''];

const TE_TA_BASE_MAP: ReadonlyMap<string, string> = (() => {
  const m = new Map<string, string>();

  for (const irregular of IRREGULAR_VERBS) {
    for (const form of irregular.forms) {
      m.set(form, irregular.base);
      // Stacked te-iru family for irregular te-forms (e.g. 行っている → 行く)
      if (form.endsWith('て')) {
        for (const stacked of TE_STACKED_SUFFIXES) {
          if (!stacked) continue;
          m.set(`${form}${stacked}`, irregular.base);
        }
      }
    }
  }

  (Object.keys(GODAN_VERBS) as readonly GodanSuffix[]).forEach((suffix) => {
    const { te, ta } = GODAN_CONJUGATIONS[suffix];
    for (const base of GODAN_VERBS[suffix]) {
      if (!base.endsWith(suffix)) continue; // sanity guard
      const stem = base.slice(0, -1);
      const teForm = `${stem}${te}`;
      const taForm = `${stem}${ta}`;
      for (const stacked of TE_STACKED_SUFFIXES) {
        m.set(`${teForm}${stacked}`, base);
      }
      for (const stacked of TA_STACKED_SUFFIXES) {
        m.set(`${taForm}${stacked}`, base);
      }
    }
  });

  return m;
})();

/**
 * Returns the dictionary base form for a curated te/ta-form (and common te-iru
 * stacked variants), or null when the input is not in the curated table.
 *
 * Caller is expected to NFKC-normalize the raw input. We normalize defensively
 * here too so accidental full-width/half-width drift does not cause misses.
 */
export function lookupTeFormBase(raw: string): string | null {
  return TE_TA_BASE_MAP.get(raw.normalize('NFKC')) ?? null;
}

/** Internal — exposed for unit tests / introspection only. */
export const __TE_TA_BASE_MAP_FOR_TESTS = TE_TA_BASE_MAP;
