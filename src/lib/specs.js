// Up to three optional label/value rows on a listing (0029_tool_specs.sql) --
// "Voltage / 18V", "Height / 8 ft", "Blade / 7-1/4 in". Deliberately not
// fixed columns: the attribute that matters differs completely between a
// drill and a ladder.
export const MAX_SPECS = 3;

/** Blank rows the form starts from (and pads back out to after editing). */
export function emptySpecs() {
  return Array.from({ length: MAX_SPECS }, () => ({ label: "", value: "" }));
}

/**
 * Form rows -> what gets stored. Drops any row missing either half (a value
 * with no label is unreadable, a label with no value says nothing), trims
 * both, and returns null rather than [] so an untouched listing stores
 * nothing at all.
 */
export function packSpecs(rows) {
  const packed = (rows ?? [])
    .map((r) => ({ label: (r.label ?? "").trim(), value: (r.value ?? "").trim() }))
    .filter((r) => r.label && r.value)
    .slice(0, MAX_SPECS);
  return packed.length > 0 ? packed : null;
}

/** Stored value -> form rows, padded back to MAX_SPECS blanks. */
export function unpackSpecs(specs) {
  const rows = Array.isArray(specs)
    ? specs
        .filter((r) => r && typeof r === "object")
        .slice(0, MAX_SPECS)
        .map((r) => ({ label: String(r.label ?? ""), value: String(r.value ?? "") }))
    : [];
  return [...rows, ...emptySpecs()].slice(0, MAX_SPECS);
}

/** Stored value -> rows worth rendering. Tolerates anything malformed. */
export function readSpecs(specs) {
  if (!Array.isArray(specs)) return [];
  return specs
    .filter((r) => r && typeof r === "object" && r.label && r.value)
    .slice(0, MAX_SPECS)
    .map((r) => ({ label: String(r.label), value: String(r.value) }));
}
