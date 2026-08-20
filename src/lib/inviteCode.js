// Short, human-typeable invite code for a new group. Excludes visually
// confusable characters (0/O, 1/I/L) since people will be reading these off
// a phone screen or hearing them said aloud.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/**
 * Uses crypto.getRandomValues rather than Math.random: V8's PRNG state is
 * recoverable from a modest number of outputs, so Math.random would make codes
 * predictable from a handful of observed ones. Rejection sampling keeps the
 * distribution uniform — taking `value % 31` would bias the first few letters.
 */
export function generateInviteCode(length = 7) {
  const max = Math.floor(256 / ALPHABET.length) * ALPHABET.length; // 248
  const out = [];
  const buf = new Uint8Array(length * 2);

  while (out.length < length) {
    crypto.getRandomValues(buf);
    for (const byte of buf) {
      if (byte >= max) continue; // would skew the distribution — draw again
      out.push(ALPHABET[byte % ALPHABET.length]);
      if (out.length === length) break;
    }
  }

  return out.join("");
}
