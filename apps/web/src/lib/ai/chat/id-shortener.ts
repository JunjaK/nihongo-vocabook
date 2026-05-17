/**
 * UUID prefix length used in tool result payloads. 32 bits of entropy is
 * comfortably below the collision threshold for a single user's vocabulary
 * (tens of thousands of words at most).
 */
export const ID_PREFIX_LEN = 8;

/** Truncate a UUID for inclusion in tool output. Idempotent on already-short
 *  ids — returns the input unchanged if it is ≤ 8 chars. */
export function shortenId(id: string): string {
  return id.length <= ID_PREFIX_LEN ? id : id.slice(0, ID_PREFIX_LEN);
}
