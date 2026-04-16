---
model: sonnet
description: Generate example sentences for words that lack them and write to DB
---

You are a Japanese language expert generating natural example sentences for the Nihongo VocaBook project.

## Task

1. Fetch words that have no example sentences from the database
2. Generate 2 natural example sentences per word
3. Write results back to the `word_examples` table

## Steps

### Step 1: Fetch words without examples

Run a bun script to fetch words from the database. Use this exact DB connection pattern:

```ts
import postgres from 'postgres';
import { readFileSync } from 'fs';
const envContent = readFileSync('.env.local', 'utf-8');
const line = envContent.split('\n').find(l => l.startsWith('NEXT_PRIVATE_SUPABASE_DB_LINK_SESSION='));
const dbUrl = line.slice('NEXT_PRIVATE_SUPABASE_DB_LINK_SESSION='.length).trim();
const s = dbUrl.indexOf('://') + 3;
const r = dbUrl.slice(s);
const a = r.lastIndexOf('@');
const c = r.slice(0, a);
const h = r.slice(a + 1);
const ci = c.indexOf(':');
const sql = postgres({
  host: h.split('/')[0].split(':')[0],
  port: Number(h.split('/')[0].split(':')[1]) || 5432,
  database: h.split('/')[1],
  username: c.slice(0, ci),
  password: c.slice(ci + 1),
  ssl: 'require'
});
```

Query to fetch words without examples:

```sql
SELECT w.id, w.term, w.reading, w.meaning
FROM words w
LEFT JOIN word_examples we ON we.word_id = w.id
WHERE we.id IS NULL
ORDER BY w.created_at DESC
LIMIT $1
```

Write results to `/tmp/example-gen-batch.json`.

### Step 2: Generate example sentences

Read `/tmp/example-gen-batch.json` and generate 2 example sentences per word.

For each word, produce sentences following these rules:

- **sentence_ja**: A natural, everyday Japanese sentence using the target word. JLPT N5-N3 grammar preferred unless the word itself is advanced.
- **sentence_reading**: Full hiragana reading of the sentence (furigana for all kanji).
- **sentence_meaning**: Korean translation of the sentence. Use natural Korean, not word-by-word translation.
- The two sentences should demonstrate different usages or contexts of the word.
- Keep sentences 10-25 characters long (concise, not overly complex).
- Do NOT use the word only in its dictionary form — conjugate naturally.

Example output format for one word:

```json
{
  "word_id": "uuid-here",
  "examples": [
    {
      "sentence_ja": "毎朝コーヒーを飲む。",
      "sentence_reading": "まいあさこーひーをのむ。",
      "sentence_meaning": "매일 아침 커피를 마신다."
    },
    {
      "sentence_ja": "薬を飲んでください。",
      "sentence_reading": "くすりをのんでください。",
      "sentence_meaning": "약을 드세요."
    }
  ]
}
```

Process in batches of 10 words (20 sentences). Write all results to `/tmp/example-gen-results.json` as a flat array:

```json
[
  {"word_id": "...", "sentence_ja": "...", "sentence_reading": "...", "sentence_meaning": "..."},
  ...
]
```

### Step 3: Write to DB

Write a bun script (save to `/tmp/write-examples.ts`) that reads `/tmp/example-gen-results.json` and inserts into the database:

```sql
INSERT INTO word_examples (word_id, sentence_ja, sentence_reading, sentence_meaning, source)
VALUES ($1, $2, $3, $4, 'claude')
```

Log the count of inserted examples and remaining words without examples.

## Arguments

If the user provides a number as argument (e.g. `/generate-examples 50`), use that as the LIMIT instead of the default 20.

$ARGUMENTS
