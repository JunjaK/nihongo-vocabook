---
name: supabase-ops
description: |
  Running ad-hoc SQL against Supabase, managing auth.users (email confirm,
  password reset, soft-delete), backfilling rows, debugging RLS, checking
  SMTP / migration state, and any DB admin work that lives outside the
  Repository layer. Use whenever the user mentions Supabase, auth users,
  email verification, "supabase sql", service role, RLS, SMTP, or asks for
  one-off database admin operations — even when they don't name the tool.
  Prefer this over rediscovering the connection pattern from scratch.
---

# Supabase Operations

> **psql is NOT installed in this environment.** Use HTTP API (curl), the
> `postgres` npm package via Bun, or the Dashboard SQL Editor. See the
> decision tree below.

## Credentials live in `apps/web/.env.local`

| Var | Use case |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Base URL — `https://<ref>.supabase.co`. The `<ref>` (project ref) appears in the hostname and is needed for Management API calls. |
| `NEXT_PRIVATE_SUPABASE_SERVICE_ROLE_KEY` | Admin secret. Bypasses RLS for the project's data plane (Pattern 1, 2). **Never log, commit, or send to client.** |
| `NEXT_PRIVATE_SUPABASE_DB_LINK_SESSION` | Direct postgres pooler URL (port 5432). Password contains `#` — see Pattern 3 for the parsing gotcha. |
| `SUPABASE_MGMT_TOKEN` | Management API token (`sbp_*`). Configures the project itself — SMTP, auth toggles, redirect URLs, providers, billing. **Account-scoped — affects ALL projects under the account.** Even more sensitive than the service-role key. See Pattern 5. |

Read access to `.env.local` is pre-allowed in `.claude/settings.local.json`.

## Decision tree

```
Need to read/modify auth.users?           → Pattern 1 (Admin API only — PostgREST does NOT expose auth.*)
Single-table CRUD on public schema?       → Pattern 2 (PostgREST + service role)
Multi-statement SQL / DDL / migration?    → Pattern 3 (postgres package via Bun)
Destructive one-off on prod?              → Pattern 4 (Dashboard SQL Editor — human eyes-on)
Project config (SMTP, redirect URLs,      → Pattern 5 (Management API + sbp_ token)
  email-confirm toggle, providers)?
```

## Pattern 1 — Admin API (auth.users)

```bash
SUPA_URL=$(grep ^NEXT_PUBLIC_SUPABASE_URL apps/web/.env.local | cut -d= -f2)
SRK=$(grep ^NEXT_PRIVATE_SUPABASE_SERVICE_ROLE_KEY apps/web/.env.local | cut -d= -f2)

# List users (page is required; per_page max 1000)
curl -sS "$SUPA_URL/auth/v1/admin/users?page=1&per_page=200" \
  -H "apikey: $SRK" -H "Authorization: Bearer $SRK" -o /tmp/users.json

# Confirm a user's email
curl -sS -X PUT "$SUPA_URL/auth/v1/admin/users/<USER_ID>" \
  -H "apikey: $SRK" -H "Authorization: Bearer $SRK" \
  -H "Content-Type: application/json" \
  -d '{"email_confirm": true}'

# Force password reset
# Same PUT with: -d '{"password": "..."}'

# Soft-delete (recommended over hard DELETE)
# Same PUT with: -d '{"banned_until": "2099-12-31T00:00:00Z"}'

# Hard delete (last resort)
curl -sS -X DELETE "$SUPA_URL/auth/v1/admin/users/<USER_ID>" \
  -H "apikey: $SRK" -H "Authorization: Bearer $SRK"
```

**Why curl writes to a file**: large user lists can exceed shell pipe buffers
when piped through `python3` inline. Write to `/tmp/users.json`, then parse.

**Filtering unconfirmed users** (the common backfill prep):
```bash
python3 -c "
import json
data = json.load(open('/tmp/users.json'))
unconfirmed = [u for u in data['users'] if not u.get('email_confirmed_at')]
print(f'Unconfirmed: {len(unconfirmed)}')
for u in unconfirmed:
    print(f\"  {u['id']}  {u['email']}\")"
```

## Pattern 2 — PostgREST + service role (public schema only)

```bash
# SELECT
curl -sS "$SUPA_URL/rest/v1/words?select=id,term,reading&limit=10" \
  -H "apikey: $SRK" -H "Authorization: Bearer $SRK"

# UPDATE
curl -sS -X PATCH "$SUPA_URL/rest/v1/words?id=eq.<UUID>" \
  -H "apikey: $SRK" -H "Authorization: Bearer $SRK" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" \
  -d '{"meaning": "..."}'

# DELETE (use sparingly — prefer soft-delete column if available)
curl -sS -X DELETE "$SUPA_URL/rest/v1/words?id=eq.<UUID>" \
  -H "apikey: $SRK" -H "Authorization: Bearer $SRK"
```

PostgREST can't do JOINs or run raw SQL — fall back to Pattern 3 for those.

## Pattern 3 — postgres package via Bun (multi-statement / DDL)

The canonical pattern is `apps/web/scripts/run-migrations.ts`. Copy and adapt:

```ts
import postgres from 'postgres';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// .env.local password contains '#' which breaks URL parsing — read raw and split manually.
const envContent = readFileSync(join(__dirname, '..', '.env.local'), 'utf-8');
const dbUrl = envContent.split('\n')
  .find(l => l.startsWith('NEXT_PRIVATE_SUPABASE_DB_LINK_SESSION='))!
  .slice('NEXT_PRIVATE_SUPABASE_DB_LINK_SESSION='.length).trim();

const rest = dbUrl.slice(dbUrl.indexOf('://') + 3);
const lastAt = rest.lastIndexOf('@');
const credentials = rest.slice(0, lastAt);
const colonIdx = credentials.indexOf(':');
const username = credentials.slice(0, colonIdx);
const password = credentials.slice(colonIdx + 1);
const [hostPort, database] = rest.slice(lastAt + 1).split('/');
const [host, portStr] = hostPort.split(':');

const sql = postgres({
  host, port: Number(portStr) || 5432, database, username, password,
  ssl: 'require',
});

// Tagged template gives parameter binding (SQL injection safe)
const rows = await sql`
  SELECT id, email FROM auth.users WHERE email_confirmed_at IS NULL
`;
console.log(rows);

// For DDL / multi-statement, use sql.unsafe (no binding, raw SQL)
// await sql.unsafe(readFileSync(migrationPath, 'utf-8'));

await sql.end();
```

Run with `bun run apps/web/scripts/<name>.ts`. Place ad-hoc scripts under
`apps/web/scripts/` even if one-shot — that's the established convention and
the path resolution above assumes that location.

## Pattern 5 — Management API (project config)

Configures the project itself — auth settings, SMTP, redirect URL allow-list,
providers, billing. Uses a **separate token** (`sbp_*`) from the service-role
key. Base URL is `https://api.supabase.com` (not the project subdomain).

```bash
MGMT=$(grep ^SUPABASE_MGMT_TOKEN apps/web/.env.local | cut -d= -f2)
REF=$(grep ^NEXT_PUBLIC_SUPABASE_URL apps/web/.env.local \
        | cut -d= -f2 | sed 's|https://||' | cut -d. -f1)

# Read current auth config (includes SMTP, redirect URLs, email-confirm flag)
curl -sS "https://api.supabase.com/v1/projects/$REF/config/auth" \
  -H "Authorization: Bearer $MGMT" | python3 -m json.tool

# Toggle "Confirm email" requirement (mailer_autoconfirm: false = require confirm)
curl -sS -X PATCH "https://api.supabase.com/v1/projects/$REF/config/auth" \
  -H "Authorization: Bearer $MGMT" -H "Content-Type: application/json" \
  -d '{"mailer_autoconfirm": false}'

# Configure SMTP (e.g. Resend)
curl -sS -X PATCH "https://api.supabase.com/v1/projects/$REF/config/auth" \
  -H "Authorization: Bearer $MGMT" -H "Content-Type: application/json" \
  -d '{
    "smtp_admin_email": "noreply@<your-verified-domain>",
    "smtp_sender_name": "<Sender Name>",
    "smtp_host": "smtp.resend.com",
    "smtp_port": 465,
    "smtp_user": "resend",
    "smtp_pass": "re_...",
    "smtp_max_frequency": 60
  }'

# Add to redirect URL allow-list (replace, not append — server stores comma-joined)
curl -sS -X PATCH "https://api.supabase.com/v1/projects/$REF/config/auth" \
  -H "Authorization: Bearer $MGMT" -H "Content-Type: application/json" \
  -d '{"uri_allow_list": "https://nivoca.jun-devlog.win/**,http://localhost:3000/**"}'

# Update Site URL
curl -sS -X PATCH "https://api.supabase.com/v1/projects/$REF/config/auth" \
  -H "Authorization: Bearer $MGMT" -H "Content-Type: application/json" \
  -d '{"site_url": "https://nivoca.jun-devlog.win"}'
```

**Why the field names look different from the Dashboard UI**: the Management
API uses GoTrue's underlying field names (`mailer_autoconfirm`, `smtp_admin_email`).
A `GET` first shows the exact schema currently in use — use that as the
reference rather than guessing.

**Project ref** is the subdomain of `NEXT_PUBLIC_SUPABASE_URL` —
`https://<ref>.supabase.co` → `<ref>`. The cut command above extracts it.

**Other useful endpoints** (read-only is safe; mutations need care):

| Endpoint | Purpose |
|---|---|
| `GET /v1/projects` | List all projects under this account |
| `GET /v1/projects/{ref}` | Project metadata |
| `GET /v1/projects/{ref}/api-keys` | Anon + service-role key values |
| `PATCH /v1/projects/{ref}/database` | DB password / pooler settings |
| `GET /v1/projects/{ref}/secrets` | Edge Function secrets |
| `POST /v1/projects/{ref}/functions` | Deploy Edge Function |

**Security**: `sbp_` tokens have **no scope separation** — they're full admin
on every project under the account. Treat as more sensitive than service-role.
Revoke at https://supabase.com/dashboard/account/tokens if compromised.

## Pattern 4 — Dashboard SQL Editor

For destructive one-offs on prod (DELETE, TRUNCATE, schema migrations on a
populated table), the SQL Editor at
`https://supabase.com/dashboard/project/<ref>/sql/new` is the safest path.
The visible dry-run output before a human-pressed RUN button catches more
mistakes than any pre-flight script. Use Pattern 3 only when the operation
will be re-run or needs to live in version control.

## Safety rules

- **Dry-run first.** Run the SELECT version of every UPDATE/DELETE and show
  affected rows before executing the mutation. Even if the user pre-approved
  the operation, the dry-run is the audit trail.
- **`RETURNING` everything.** On UPDATE/DELETE, always append
  `RETURNING id, ...` so the result is the receipt of what changed.
- **Service role key never reaches the client.** Don't put it in any code
  path that ships to the browser. Don't paste it into logs. Treat it like
  a root password.
- **Confirm between dry-run and execute** when the operation is destructive
  on production data — even mid-task, even with prior authorization.

## Common gotchas

- **`psql` is not installed.** Don't even try — use HTTP or the `postgres`
  package.
- **DB password has `#`.** `new URL(dbUrl)` will silently truncate after
  `#`. Always parse manually (Pattern 3 has the working parser).
- **auth.users can't be read via PostgREST.** It's in the `auth` schema, not
  `public` — PostgREST only exposes `public`. Use the Admin API.
- **Don't shell-pipe large JSON.** Write curl output to `/tmp/users.json`
  and parse from there; long stdout pipes can truncate or buffer-block.
- **Pooler URL is session mode** (port 5432). For transaction-mode pooling
  you'd use port 6543 — don't, the `postgres` package wants session.
- **E2E pre-confirmed accounts**: `e2e@test.com` and `e2e1~5@test.com` are
  already confirmed in Supabase. Don't recreate them.

## Common operations cheat-sheet

| Task | Pattern |
|---|---|
| List unconfirmed users / backfill `email_confirmed_at` | 1 (loop PUT) |
| Add column to a table on prod | 4 (Dashboard) |
| Bulk update `public.dictionary_entries` from a CSV | 3 (Bun script) |
| One-off "find rows where X" for debugging | 2 (PostgREST) or 3 |
| Toggle email-confirm requirement | 5 (`mailer_autoconfirm` field) |
| Configure SMTP (Resend etc.) | 5 (`smtp_*` fields) |
| Add redirect URL to allow-list | 5 (`uri_allow_list`) |
| Check why emails aren't sending | Resend dashboard → Logs (not Supabase) |
| Migration not yet applied | 3 via `bun run apps/web/scripts/run-migrations.ts` |

## Related

- `apps/web/scripts/run-migrations.ts` — canonical Pattern 3 implementation
- `data-layer` skill — Repository pattern (in-app DB access, not admin)
- `MEMORY.md` — pre-confirmed E2E account list
