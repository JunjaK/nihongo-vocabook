/**
 * Safe interpolation helpers for PostgREST filter strings.
 *
 * The Supabase client's `.or()` / `.in()` / `.eq()` chained with raw string
 * filters bypass parameterization. A user-controlled value pasted into
 * `term.ilike.%${q}%` can escape the value (via `,`, `()`, `:`) and append
 * arbitrary filter clauses — not classic SQL injection, but enough to alter
 * query semantics, leak schema info, or sidestep filtering logic.
 *
 * Two strategies, picked per operator:
 *
 *   - `ilike.%...%` patterns: STRIP filter/LIKE metachars from the value.
 *     Wildcards aren't useful when we already wrap the value with `%`s, and
 *     quoting the value disables the wrap, so stripping is the cleanest fix.
 *
 *   - `eq.<v>` and `in.(...)` lists: QUOTE the value. PostgREST allows
 *     `"foo,bar"` to embed literal commas, with `\` and `"` themselves
 *     escaped via backslash.
 *
 * Both also cap length so a 10 MB query string can't be DOS'd through.
 */

const DEFAULT_MAX_LEN = 100;

/** Chars that have special meaning in PostgREST filter syntax or SQL LIKE
 *  patterns. Stripped before interpolation in `ilike` queries. */
const POSTGREST_LIKE_META = /[,()\\":*%_]/g;

/**
 * Sanitize a value for interpolation into a PostgREST `ilike.%<v>%` pattern.
 * Returns an empty string when the input degenerates — callers should
 * short-circuit and return no results in that case.
 */
export function sanitizeIlikeQuery(q: string, maxLen = DEFAULT_MAX_LEN): string {
  return q.replace(POSTGREST_LIKE_META, '').trim().slice(0, maxLen);
}

/**
 * Quote a value for safe inclusion inside a PostgREST `in.(...)` list or as
 * the operand of `eq.`/`neq.`/etc. The returned string includes surrounding
 * double quotes — interpolate as `term.in.(${quotePostgrestValue(v)},...)`.
 */
export function quotePostgrestValue(v: string, maxLen = DEFAULT_MAX_LEN): string {
  const capped = v.slice(0, maxLen);
  const escaped = capped.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${escaped}"`;
}
