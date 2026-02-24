# Dictionary Search Improvements

## Context

Dictionary search currently uses exact `term` match against the DB. Searching by reading (e.g. `たべる`) always misses the cache and falls through to Jisho API. Additionally, the batch API has unused `locale` param, upsert can lose data on concurrent requests, and kana-only words show duplicate text in the UI.

## Changes

### 1. DB Fuzzy Search: term OR reading (`src/app/api/dictionary/route.ts`)

**Current**: `supabase.from('dictionary_entries').select(...).eq('term', query)`

**Change**: Search both `term` and `reading` columns using Supabase `.or()`:

```ts
// Single search
const { data: rows } = await supabase
  .from('dictionary_entries')
  .select('term, reading, meanings, meanings_ko, parts_of_speech, jlpt_level')
  .or(`term.eq.${query},reading.eq.${query}`)
  .limit(10);
```

This way `たべる` finds `term='食べる', reading='たべる'` from DB cache.

### 2. Reading Index Migration (`supabase/migrations/016_dictionary_reading_index.sql`)

```sql
CREATE INDEX IF NOT EXISTS idx_dictionary_entries_reading ON dictionary_entries(reading);
```

Add to `scripts/run-migrations.ts` migration list (also add missing `014` and `015` entries).

### 3. Batch API Fuzzy Search (`src/app/api/dictionary/batch/route.ts`)

**Current**: `.in('term', uniqueTerms)` — exact term match only.

**Change**: Search both `term` and `reading` columns. Use `.or()` with two `in` filters:

```ts
const { data: rows } = await supabase
  .from('dictionary_entries')
  .select('term, reading, meanings, meanings_ko, parts_of_speech, jlpt_level')
  .or(`term.in.(${uniqueTerms.join(',')}),reading.in.(${uniqueTerms.join(',')})`);
```

Group results by the **queried term** (not just `row.term`). A query for `たべる` that matches `term='食べる', reading='たべる'` should appear under the key `たべる` in the `found` map.

Also remove the unused `locale` destructuring from the body since batch doesn't do on-demand translation (Korean data is already in the DB).

### 4. Upsert Merge (`src/app/api/dictionary/route.ts`)

**Current** (line 188):
```ts
.upsert(entries, { onConflict: 'term,reading', ignoreDuplicates: true })
```

**Change**: Remove `ignoreDuplicates` so on conflict it updates the row (merging Korean translations from concurrent requests):

```ts
.upsert(entries, { onConflict: 'term,reading' })
```

This ensures if a second concurrent request brings Korean translations, they overwrite the empty `meanings_ko` from the first insert.

### 5. Kana-Only Word Duplicate Display (`src/components/word/word-search.tsx`)

**Current** (line 126-129): Always shows `reading` next to `word`:
```tsx
{jp?.word && (
  <span className="ml-2 text-sm font-normal text-muted-foreground">
    {jp.reading}
  </span>
)}
```

**Change**: Only show reading when it differs from word:
```tsx
{jp?.word && jp.word !== jp.reading && (
  <span className="ml-2 ...">
    {jp.reading}
  </span>
)}
```

## Files Created
- `supabase/migrations/016_dictionary_reading_index.sql`

## Files Modified
- `scripts/run-migrations.ts` — add migration entries for 014, 015, 016
- `src/app/api/dictionary/route.ts` — fuzzy search (term OR reading) + upsert merge
- `src/app/api/dictionary/batch/route.ts` — fuzzy search (term OR reading in batch)
- `src/components/word/word-search.tsx` — kana-only duplicate fix

## Verification
1. Run migration: `bun run scripts/run-migrations.ts`
2. Test single search by reading: `GET /api/dictionary?q=たべる` → should hit DB cache (returns 食べる entry)
3. Test single search by term: `GET /api/dictionary?q=食べる` → still works as before
4. Test batch search with mixed terms/readings → found map keyed correctly
5. Test concurrent upserts → second request's data not silently dropped
6. Test kana-only word display (e.g. おいしい) → no duplicate reading shown
