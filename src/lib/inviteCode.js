// Short, human-typeable invite code for a new group. Excludes visually
// confusable characters (0/O, 1/I/L) since people will be reading these off
// a phone screen or hearing them said aloud.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generateInviteCode(length = 7) {
  let code = "";
  for (let i = 0; i < length; i++) {
    code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return code;
}
