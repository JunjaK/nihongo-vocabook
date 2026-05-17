/**
 * UUID prefix length used in tool result payloads. The `idTable` that maps
 * short → full id is session-scoped (reset on every chat-session boundary —
 * see store.ts), so the collision threshold that matters is the number of
 * entities referenced within a single conversation, not the user's total
 * vocabulary. A typical session touches well under 500 entities; at 500
 * entries against 2^32 buckets, P(collision) ≈ 3e-5. Safe for our use.
 *
 * The harvest path in `tools.ts` also guards against a short-id collision
 * by checking whether the same prefix is being remapped to a different
 * full id, which catches the rare case where two long UUIDs do happen to
 * share their first 8 chars within one session.
 */
export const ID_PREFIX_LEN = 8;

/** Truncate a UUID for inclusion in tool output. Idempotent on already-short
 *  ids — returns the input unchanged if it is ≤ 8 chars. */
export function shortenId(id: string): string {
  return id.length <= ID_PREFIX_LEN ? id : id.slice(0, ID_PREFIX_LEN);
}
