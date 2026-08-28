// Regenerates src/lib/toolCategories.js from the taxonomy CSV.
//
//   node scripts/generate-categories.mjs      (or: npm run categories)
//
// The CSV is the source of truth; the JS module is a build artifact that
// happens to be committed. Edit the CSV and re-run this — hand-editing the
// module means the next regeneration silently discards your change.
import { readFileSync, writeFileSync } from "node:fs";

const CSV = "Tool Categories/garage_tool_categories.csv";
const OUT = "src/lib/toolCategories.js";

/** Minimal RFC4180 row parser — the source quotes any field containing a comma. */
function parseRow(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') inQuotes = false;
      else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

const lines = readFileSync(CSV, "utf8").trim().split(/\r?\n/);
const header = parseRow(lines[0]);
const idx = Object.fromEntries(header.map((h, i) => [h, i]));

const byCategory = new Map();
for (const line of lines.slice(1)) {
  if (!line.trim()) continue;
  const cols = parseRow(line);
  const category = cols[idx.category];
  if (!byCategory.has(category)) {
    byCategory.set(category, { category, order: Number(cols[idx.category_order]), subs: [] });
  }
  byCategory.get(category).subs.push({
    subcategory: cols[idx.subcategory],
    order: Number(cols[idx.subcategory_order]),
  });
}

const cats = [...byCategory.values()].sort((a, b) => a.order - b.order);
for (const c of cats) c.subs.sort((a, b) => a.order - b.order);

const body = cats
  .map((c) => {
    const subs = c.subs.map((s) => `      ${JSON.stringify(s.subcategory)},`).join("\n");
    return `  {\n    category: ${JSON.stringify(c.category)},\n    subcategories: [\n${subs}\n    ],\n  },`;
  })
  .join("\n");

const subCount = cats.reduce((n, c) => n + c.subs.length, 0);

writeFileSync(
  OUT,
  `// GENERATED FILE — do not edit by hand.
// Regenerate with \`npm run categories\` after changing
// \`Tool Categories/garage_tool_categories.csv\`, which is the source of truth.
//
// Both levels matter. A listing stores its parent \`category\` and its
// \`subcategory\` in separate columns (0026_listing_fields.sql), and both feed
// the search vector, so "Automotive" and "Brake & suspension service" each
// find the same tool. The picker searches subcategory text as well as
// category names — a flat list of ${cats.length} top-level categories was far too
// coarse to find anything in.

export const CATEGORY_TREE = [
${body}
];

/** Just the top-level names, in source order. */
export const TOOL_CATEGORIES = CATEGORY_TREE.map((c) => c.category);

/**
 * Every pickable option, flattened for searching: one entry per subcategory,
 * plus one bare entry per category for someone who only wants to say
 * "Automotive", plus a final "Other" catch-all.
 *
 * \`label\` is what the picker matches against and shows, so typing either
 * half of "Automotive — Brake" narrows to the same row.
 */
export const CATEGORY_OPTIONS = [
  ...CATEGORY_TREE.flatMap((c) => [
    { category: c.category, subcategory: "", label: c.category },
    ...c.subcategories.map((s) => ({
      category: c.category,
      subcategory: s,
      label: \`\${c.category} — \${s}\`,
    })),
  ]),
  { category: "Other", subcategory: "", label: "Other" },
];

/** How a stored (category, subcategory) pair reads back in the UI. */
export function categoryLabel(category, subcategory) {
  if (!category) return "";
  return subcategory ? \`\${category} — \${subcategory}\` : category;
}
`
);

console.log(`${OUT}: ${cats.length} categories, ${subCount} subcategories`);
