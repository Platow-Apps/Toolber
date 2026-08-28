import test from "ava";
import { emptySpecs, MAX_SPECS, packSpecs, readSpecs, unpackSpecs } from "./specs.js";

test("an untouched form stores nothing rather than three empty rows", (t) => {
  t.is(packSpecs(emptySpecs()), null);
  t.is(packSpecs([]), null);
  t.is(packSpecs(null), null);
});

test("drops a row with only one half filled in", (t) => {
  // A value with no label is unreadable; a label with no value says nothing.
  t.is(packSpecs([{ label: "Voltage", value: "" }]), null);
  t.is(packSpecs([{ label: "", value: "18V" }]), null);
});

test("trims both halves and keeps the complete rows", (t) => {
  t.deepEqual(
    packSpecs([
      { label: "  Voltage ", value: " 18V " },
      { label: "", value: "" },
      { label: "Size", value: "7-1/4 in" },
    ]),
    [
      { label: "Voltage", value: "18V" },
      { label: "Size", value: "7-1/4 in" },
    ]
  );
});

test("never stores more rows than the database constraint allows", (t) => {
  const many = Array.from({ length: 8 }, (_, i) => ({ label: `L${i}`, value: `V${i}` }));
  t.is(packSpecs(many).length, MAX_SPECS);
});

test("round-trips through storage and back into form rows", (t) => {
  const stored = packSpecs([{ label: "Voltage", value: "18V" }]);
  const rows = unpackSpecs(stored);
  t.is(rows.length, MAX_SPECS, "padded back out to fixed slots");
  t.deepEqual(rows[0], { label: "Voltage", value: "18V" });
  t.deepEqual(rows[1], { label: "", value: "" });
  t.deepEqual(packSpecs(rows), stored, "and packs back to the same thing");
});

test("survives anything malformed in the column", (t) => {
  // specs is jsonb — a hand-edited row, or an older client, could put anything
  // there, and a tool page must still render.
  for (const junk of [null, undefined, "not an array", 42, {}, [null], [{ label: "x" }], [{ value: "y" }]]) {
    t.notThrows(() => readSpecs(junk), String(junk));
    t.true(Array.isArray(readSpecs(junk)), String(junk));
  }
  t.deepEqual(readSpecs([{ label: "x" }]), [], "half a row is not renderable");
  t.deepEqual(unpackSpecs("garbage").length, MAX_SPECS);
});

test("coerces non-string values rather than rendering objects", (t) => {
  t.deepEqual(readSpecs([{ label: 12, value: 18 }]), [{ label: "12", value: "18" }]);
});
