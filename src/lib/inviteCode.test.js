import test from "ava";
import { generateInviteCode } from "./inviteCode.js";

// The alphabet deliberately drops visually confusable glyphs so codes survive
// being read off a phone screen or said out loud.
const CONFUSABLE = ["0", "O", "1", "I", "L"];

test("defaults to seven characters", (t) => {
  t.is(generateInviteCode().length, 7);
});

test("honours an explicit length", (t) => {
  t.is(generateInviteCode(1).length, 1);
  t.is(generateInviteCode(12).length, 12);
});

test("only ever emits uppercase letters and digits", (t) => {
  for (let i = 0; i < 200; i++) {
    t.regex(generateInviteCode(), /^[A-Z0-9]{7}$/);
  }
});

test("never emits a visually confusable character", (t) => {
  const sample = Array.from({ length: 500 }, () => generateInviteCode()).join("");
  for (const char of CONFUSABLE) {
    t.false(sample.includes(char), `expected no "${char}" in generated codes`);
  }
});

test("does not repeat itself across a large sample", (t) => {
  // 31^7 ≈ 2.7e10, so 2000 draws colliding would indicate a broken generator
  // rather than bad luck.
  const codes = new Set(Array.from({ length: 2000 }, () => generateInviteCode()));
  t.is(codes.size, 2000);
});

test("uses the whole alphabet, not a narrow slice", (t) => {
  const seen = new Set(Array.from({ length: 2000 }, () => generateInviteCode()).join(""));
  t.is(seen.size, 31, `expected all 31 alphabet characters, saw ${seen.size}`);
});
