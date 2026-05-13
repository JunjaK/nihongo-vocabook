# Dictionary Example Generation Auth Bug

> Status: Planning

## Spec

### Bug

When a user searches a new word that hits the Jisho fallback path, `/api/dictionary/route.ts:284-294` fires a server-side `fetch(...)` to `/api/examples/generate` for each resolved entry. The intent: kick off example generation in the background so examples are ready next time the user opens the word.

The internal `fetch()` from a Next.js Route Handler **does not carry the originating user's session cookies**, so the call lands unauthenticated. `/api/examples/generate/route.ts:94-96` rejects anonymous calls:

```ts
const { data: { user } } = await supabase.auth.getUser();
if (!user) {
  return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
}
```

→ Every fire-and-forget trigger returns **401**. No examples are ever generated via this code path. The errors are swallowed by the `.catch((err) => logger.warn(...))` on line 293 so it fails silently.

### Evidence

Phase 0 diagnostic (production, 2026-05-13):
- 547 `source='jisho'` orphans, all with **0 examples**
- 4 `source='jisho'` user-linked entries from 2026-05 missing examples — these are precisely the entries that would have been auto-generated had this worked
- 3 `source='jmdict'` user-linked from 2026-02 also missing — older path, same symptom
- The historical `source='jlpt-seed'` user-linked entries (7,676) all have examples — populated by `apps/web/scripts/backfill-meanings-ko-sonnet.ts` (or similar one-shot scripts), not by this fire-and-forget

### Impact

- New words added by the user have **no examples until manually generated** (or until the daily routine catches up — see `daily-dict-enrichment-routine.md`)
- The daily routine partially compensates but introduces up to 24h delay
- Logs show the failure but nothing alerts on it (warn-level)

### Non-goals

- Not changing the example generation prompt or model
- Not removing the `auth` gate on `/api/examples/generate` (the route is also user-callable from the client; keep that guarded)

---

## Fix options

### Option 1 — Service-role internal call

Make `/api/dictionary/route.ts` call `/api/examples/generate` using a service role bypass (header `Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}` or a separate internal route).

**Pros**: minimal surface area change, keeps single trigger path.
**Cons**: needs an internal-only path that recognizes the service-role header but still rate-limits/validates the request to prevent abuse if leaked.

### Option 2 — Move trigger to client (recommended)

After the dictionary response lands client-side, the client fires `POST /api/examples/generate { dictionaryEntryId }` for each new entry, **with session cookies attached**. This is how authenticated POSTs naturally work in Next.js — no special routing needed.

**Pros**: zero new auth machinery; bug is just "wrong actor calling the route"; fixes itself when called from the right place.
**Cons**: more network requests per dict response (mitigatable with `Promise.all`); slight UX delay before request fires; client must remember to call it.

### Option 3 — Drop the trigger entirely, rely on routine

Remove the fire-and-forget block in `/api/dictionary/route.ts:284-294`. Accept up to ~24h delay between word save and example availability. The daily routine handles all backfill.

**Pros**: simplest; removes dead code; less coupling between routes.
**Cons**: user feels lag; "freshness" of new words suffers.

### Recommendation

**Option 2 + Option 3 combined**:
- Remove the broken server-to-server fetch from `/api/dictionary/route.ts:284-294` (delete dead code)
- Add a client-side trigger in the word-save flow (`apps/web/src/components/word/word-form.tsx` submit handler): after the word is saved (we already have the `dictionaryEntryId`), `fetch('/api/examples/generate', { method: 'POST', credentials: 'include', body: JSON.stringify({ dictionaryEntryId }) })` fire-and-forget. Toast on success is optional.
- Routine remains the daily safety net for anything missed (offline saves, failed generations)

This keeps the existing route untouched, makes the example generation actually work, and the routine is the belt-and-suspenders backup.

---

## Checklist

### Phase 1 — Remove broken server trigger
- [ ] Delete `/api/dictionary/route.ts:284-294` (server fire-and-forget block)
- [ ] Verify dictionary lookups still return ids in the response (line 264-282 stays)

### Phase 2 — Client-side trigger on word save
- [ ] Find word-save submit handler (likely `apps/web/src/components/word/word-form.tsx` or repository call site)
- [ ] After successful save, fire `POST /api/examples/generate { dictionaryEntryId }` with `credentials: 'include'`
- [ ] No await — fire-and-forget; user shouldn't wait for examples
- [ ] Catch + log warn on failure (no user-facing toast)

### Phase 3 — Verify
- [ ] Add a new word via the UI → wait ~5s → verify `word_examples` rows appear for that dict entry
- [ ] Test offline word save → verify the routine catches it within 24h
- [ ] Check that anonymous users still get 401 from `/api/examples/generate` (auth gate intact)

### Phase 4 — Audit
- [ ] Search codebase for other server-to-server `fetch(${origin}/api/...)` patterns that might have the same silent-401 bug
- [ ] If any found, list them as separate items

## Open questions

- Should examples gen also fire on **wordbook add-words** or **scan confirm** flows? Today only the dict-search path triggers it (and broken). Probably yes — same client-side trigger applied at those save points.

## Implementation Notes

(Fill in when work starts.)

## User Feedback

(Pending.)

## Final Summary

(Post-completion.)
