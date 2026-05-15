# Security Pass — 2026-05-15

> Status: Complete

End-to-end security sweep across the web app, with each finding mapped to a
commit. The findings were grouped into Critical / High / Medium and processed
in that order. Critical items are now fully closed; High items are closed
with one explicit deferral (rate-limiter horizontal-scaling); Medium items
are closed with hardening rather than full reimplementation where the latter
would have invited regressions.

`bun audit --prod` vulnerability count: **73 → 52**. The remaining 52 are
exclusively transitive vulns in dev / build tooling (picomatch ReDoS via
vitest / expo / eslint-config-next, Hono moderate issues via the Supabase
functions runtime, `lodash` / `undici` / `postcss` indirect). None of them
sit on the production request path.

---

## Commits

| Hash | Title |
|---|---|
| `e31e2ae` | chore(security): untrack .ipa build artifacts, ignore future builds |
| `4f2ff68` | chore(security): harden input boundaries and add server-side guards |
| `913a936` | chore(api): drop anonymous UA-based bot gate |
| `a82906a` | chore(api): redact DB errors + drop kanji bot gate |
| `bfe0ff3` | chore(deps): bump next 16.1.6→16.2.6 + react 19.2.3→19.2.6 |
| `1f5d2ee` | chore(security): validate profile inputs + harden chart CSS injection |

Plus a history rewrite via `git filter-repo` that purged three committed
`.ipa` build artifacts (~46 MB) from every commit, followed by a
`git push origin --force`. A mirror backup of the pre-rewrite repo lives at
`../nihongo-vocabook-backup-20260515-215338.git` — keep for ~1 week then
delete.

---

## Findings & resolutions

### 🚨 Critical

#### 1. Build artifacts committed to git — closed
**Evidence:** `apps/mobile/build-1778687616658.ipa` + 2 more were tracked in
`508699b`. ~46 MB total embedded a signed bundle.

**Mitigation:** unstaged via `git rm --cached`, added `*.ipa` / `*.app` /
`*.xcarchive` to `.gitignore`, then ran `git filter-repo --invert-paths` to
purge them from every commit in history and force-pushed.

**Residual risk:** GitHub may retain blob objects in their internal cache
for ~90 days. Acceptable for a solo private repo. Pre-rewrite bundle was
scanned (`jsbundle` + `Info.plist`) for embedded secrets — none found, so
no key rotation was required.

#### 2. `.env*` not in `.gitignore` — closed (no-op)
**Evidence:** `.env.local` and `.env` exist locally; the older `.gitignore`
revision did not have `.env*` rule.

**Mitigation:** confirmed `.env*` IS already in `.gitignore` at line 46
(present-day repo state). `git log --all -- '**/.env'` returned empty —
the files have never been committed. No action required.

#### 3. PostgREST `.or()` filter injection — closed
**Evidence:** three sites interpolated user-controlled values directly into
PostgREST filter strings:
- `apps/web/src/lib/repository/supabase-repo.ts:394` —
  `term.ilike.%${query}%,reading.ilike.%${query}%,meaning.ilike.%${query}%`
- `apps/web/src/app/api/dictionary/batch/route.ts:89` —
  `term.in.(${termList}),reading.in.(${termList})`
- `apps/web/src/app/api/dictionary/route.ts:213` — `term.eq.${v}` per variant

A query of `foo,reading.eq.bar` could extend the OR group with attacker-
chosen clauses. Not classic SQL injection (RLS still scoped the rows), but
sufficient to leak rows the user shouldn't have matched against.

**Mitigation:** introduced `apps/web/src/lib/api/postgrest-safe.ts` with
two helpers:
- `sanitizeIlikeQuery(q)` — strips PostgREST + SQL LIKE metachars
  (`[,()\\":*%_]`), trims, caps at 100 chars. Empty result → caller
  short-circuits and returns no rows.
- `quotePostgrestValue(v)` — wraps in `"…"` with `\\` and `\"` escapes,
  preserving commas / parens / colons inside the value as literal data.

Eleven unit tests in `postgrest-safe.test.ts` cover the escape edge cases
(Korean / kanji preservation, separator escape, embedded quote, backslash
double-escape, length cap, degenerate inputs).

---

### ⚠️ High

#### 4. No security headers — closed
**Evidence:** `next.config.ts` set no `headers()` at all — no CSP, HSTS,
X-Frame-Options, Referrer-Policy, or Permissions-Policy. Production
deployments inherited only the platform defaults.

**Mitigation:** added a per-route `headers()` block in `next.config.ts`
applying:
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(self), microphone=(self), geolocation=()`
- `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
- `Content-Security-Policy` with `frame-ancestors 'none'`, `base-uri 'self'`,
  scoped `connect-src` (Supabase + jisho.org), and `default-src 'self'`.

**Caveat:** CSP keeps `'unsafe-inline'` + `'unsafe-eval'` in `script-src`
because Next.js's bootstrap inlines runtime scripts and esbuild-wasm uses
`eval`. Tightening this further requires wiring per-request nonces through
every `<Script>` and is a follow-up item.

#### 5. File upload accepts arbitrary size / type — closed
**Evidence:** `apps/web/src/components/scan/image-capture.tsx`
`handleFileSelect` accepted any file from a `<input type="file">` without
checking `file.size`, MIME, or count. The OCR pipeline downstream would
happily eat a 100 MB image and OOM the conversion worker.

**Mitigation:** validate at the boundary before any conversion work:
- Reject if any file has `type` not starting with `image/`
- Reject if any single file exceeds 20 MB
- Reject if more than 5 files selected in one pick (tightened from the
  initial 20 after a UX review — 5 is the practical limit for one OCR
  session and keeps the convert loop responsive)

User-facing errors via `toast.error()` with three new i18n keys
(`scan.imageTooLarge`, `scan.invalidImageType`, `scan.tooManyImages`).

#### 6. Rate limiter is in-memory + UA in bucket key — closed with deferral
**Evidence:** `apps/web/src/lib/api/rate-limit.ts` kept buckets in a
process-local `Map`, with the bucket key composed of `IP:UA`. Two
problems: rotating the User-Agent header trivially bypassed the limit,
and behind any horizontal scaler each replica enforced its own bucket.

**Mitigation (partial):** stripped UA from the bucket key (now IP-only)
and added a periodic sweep every 256 inserts to bound memory. Added a
header comment explicitly documenting the multi-replica limitation.

**Deferred:** moving to Redis / Upstash KV. This is an infrastructure
change and only matters when the app scales beyond a single Node
process — currently it ships as a single Docker container per the
GitHub Actions deploy workflow, so the single-process limit holds. Add
shared-store rate limiting before adding a second replica.

#### 7. 73 dependency vulnerabilities — closed (within semver)
**Evidence:** `bun audit --prod` returned 33 high + 36 moderate + 4 low.
The high-severity ones were all in Next.js (DoS via Server Components,
middleware bypass via segment-prefetch / dynamic route params / i18n,
SSRF via WebSocket upgrades).

**Mitigation:** package.json was pinning `next: 16.1.6` and `react:
19.2.3` exactly (no caret). Bumped to `next: 16.2.6` (minor — picks up
all the high-severity fixes), `react: 19.2.6` (patch), and re-aligned
`eslint-config-next`. Ran `bun update` to pull transitive updates within
existing semver constraints. Full vitest suite (162 tests) and `tsc
--noEmit` both pass post-update.

`bun audit --prod` reduction: 73 → 52. The remaining 52 are dev /
build-tooling transitives (picomatch ReDoS, Hono in Supabase functions,
postcss / lodash / undici) — none on the production request path.
Clearing them requires major bumps of `vitest`, `expo`, and
`eslint-config-next`, which is a separate refactor.

---

### ⚠️ Medium

#### 8. Postgres error messages leaked to clients — closed
**Evidence:** four sites returned `error.message` directly to the caller:
- `apps/web/src/app/api/dictionary/batch/route.ts:93`
- `apps/web/src/app/api/profile/route.ts:25` (GET)
- `apps/web/src/app/api/profile/route.ts:65` (PUT)
- (and one in `apps/web/src/app/api/kanji/route.ts`, cleared by another
  agent's parallel work)

Postgres errors include table names, constraint hints, and sometimes row
data in conflict errors — useful for an attacker probing the schema.

**Mitigation:** each site now logs the full message server-side via the
`createLogger(scope)` helper and returns an opaque `{ error: 'DB_ERROR' }`
with status 500.

#### 9. `/api/profile` accepted unbounded strings — closed
**Evidence:** the PUT handler took `nickname`, `avatarUrl`, `studyPurpose`
as raw strings with no type, length, or schema validation. Send a 10 MB
nickname → stored. Send `javascript:alert(1)` as `avatarUrl` → stored and
later rendered as an `<img src=…>` value.

**Mitigation:** explicit per-field validation:
- `nickname`: type `string`, trimmed, length 1–50. **Not nullable** — every
  account has a nickname auto-seeded at signup by the
  `handle_new_user` trigger in
  `supabase/migrations/005_user_profiles.sql` (`'user-' || substr(uuid,
  1, 8)`), so the API has no path to clear it. This asymmetry vs. the
  other fields is intentional.
- `avatarUrl`: nullable, parsed via `new URL()`, protocol must be `http:`
  or `https:` (blocks `javascript:` / `data:` / `blob:`), length ≤ 500
- `jlptLevel`: nullable integer 1–5 (uses `Number.isInteger`, not just
  range)
- `studyPurpose`: nullable string, length ≤ 500
- Malformed JSON body returns `INVALID_JSON` with 400 instead of crashing
  the route

#### 10. Raw HTML injection in chart.tsx — closed
**Evidence:** `apps/web/src/components/ui/chart.tsx` injected a `<style>`
tag with a template-literal-built CSS string via `__html`. The `id`, `key`,
and `color` values were trusted implicitly. Today they're developer-
controlled (generated `useId()` + static chart config), but the pattern
is fragile: the moment a user-named chart series flows into the config,
you get CSS injection.

**Mitigation:** two layers:
1. Whitelist `id` and `key` against `/^[A-Za-z0-9_-]+$/`. Drop the whole
   `<style>` if `id` is unsafe; drop individual rules where `key` is
   unsafe.
2. Reject `color` values containing CSS rule terminators
   (`[;{}<>"'`\\]`).

Also swapped the `__html`-based injection for `<style>{css}</style>`.
React renders the string as text content of the element — the browser
still parses it as CSS, but the value now flows through React's escaping
layer.

#### 11. `shouldBlockAnonymousBot` UA blocklist — closed (removed)
**Evidence:** `apps/web/src/lib/api/rate-limit.ts` exported
`shouldBlockAnonymousBot` which regex-matched UA against `bot|crawler|
spider|curl|wget|python-requests|httpclient|axios|postman|insomnia|
node-fetch`. Any attacker sent a Chrome UA and bypassed it; meanwhile
legitimate mobile clients without a UA were false-positive-blocked.

**Mitigation:** removed the function and both call sites (`api/
dictionary/route.ts`, `api/kanji/route.ts`). The IP-based rate limiter
remains as the sole anonymous-throttle layer, which is the correct
shape: throttle abuse based on traffic volume, not on cosmetic header
patterns.

---

---

## Follow-up patches (2026-05-16)

After a logic-regression review, two small hardening passes landed:

### CSP tightening
- `img-src`: dropped the blanket `https:` clause — narrowed to
  `https://*.supabase.co` (avatars + scan previews). A future XSS
  payload can no longer smuggle a tracking pixel from an arbitrary
  host.
- `connect-src`: removed `https://jisho.org`. The fallback runs in an
  API route (server-side fetch), so the browser CSP doesn't need to
  permit it.

### `getClientIp` XFF-spoofing fix
The original implementation took the **leftmost** entry of
`x-forwarded-for`, which any client can prepend itself — a single curl
request with `X-Forwarded-For: 1.2.3.4` would key the rate limiter on
a fabricated IP. Rewrote `apps/web/src/lib/api/rate-limit.ts`
`getClientIp` to:
1. Prefer `x-real-ip` (set authoritatively by the immediate reverse
   proxy, which overwrites any client value).
2. Fall back to the **rightmost** `x-forwarded-for` entry — the closest
   trusted hop's view of the caller.

If a second trusted proxy is ever introduced, the XFF index needs to
move to `-N` where N is the trusted-hop count. Documented inline.

This was already a problem before the security pass, but the previous
work made it the single source of bucket identity (UA was dropped from
the key), so fixing it is now load-bearing.

---

## What was left

| Item | Reason |
|---|---|
| Move rate limiter to Redis / Upstash | Single-process deploy today. Add before second replica. |
| Tighten CSP to remove `'unsafe-inline'` / `'unsafe-eval'` | Requires per-request nonces threaded through every `<Script>` and refactor of esbuild-wasm usage. |
| Clear remaining dev-tooling vulns (picomatch / Hono / postcss) | Requires major bumps of vitest, expo, eslint-config-next — separate scope. |
| `git filter-repo` GitHub-side cache cleanup | ~90 days self-clears. Solo private repo — acceptable. |

## Verification

- `cd apps/web && bunx tsc --noEmit` → exit 0
- `cd apps/web && bun run test` → 162/162 vitest tests pass
- `bun audit --prod` → 52 vulns (all transitive dev tooling)
- 6 commits on `main`, all pushed to `origin`

## Sanity checks for future regressions

If you find yourself reaching for any of these patterns, refer back to the
matching finding here before merging:

- **`.or()` / `.in()` / `.eq()` with interpolated user input** → must go
  through `sanitizeIlikeQuery` or `quotePostgrestValue` from
  `apps/web/src/lib/api/postgrest-safe.ts`.
- **New API route returning Postgres errors** → `logger.error(scope, err.message)`
  + opaque code to caller; never `err.message` in the response body.
- **New API route accepting user JSON** → validate types and length caps
  at the boundary; reject malformed JSON with 400 before the DB write.
- **Raw HTML injection via `__html`** → use child-text alternative
  (`<style>{css}</style>`, `<script>{js}</script>`) plus input whitelisting.
  The shadcn chart component (`apps/web/src/components/ui/chart.tsx`) is
  the reference example.
- **File upload entrypoint** → validate `file.size`, `file.type`, and the
  selection count BEFORE any conversion / OCR work. Image-capture is the
  reference example.
