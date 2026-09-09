import test from "ava";
import { readFileSync } from "node:fs";

// index.html is not part of the React tree, so nothing else in the suite would
// notice these disappearing — and their absence is invisible until someone
// pastes a link somewhere and gets a bare URL back.
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

// Whitespace-flattened rather than matched with \s+, because some of these
// tags wrap across lines. Also avoids the trap that ate the first version of
// this file: inside a template literal, \s is resolved by JavaScript to a bare
// "s" long before any regex sees it, so the pattern quietly became "<metas+".
const flat = html.replace(/\s+/g, " ");

const has = (attr, name) => flat.includes(`<meta ${attr}="${name}"`);

// String slicing rather than a built regex: semgrep blocks RegExp() with a
// non-literal pattern, and it is right to — even here, where every input is a
// constant, a dynamic pattern is a habit worth not having.
function contentOf(attr, name) {
  const opening = `<meta ${attr}="${name}" content="`;
  const start = flat.indexOf(opening);
  if (start === -1) return undefined;
  const from = start + opening.length;
  const end = flat.indexOf('"', from);
  return end === -1 ? undefined : flat.slice(from, end);
}

test("a pasted link previews with a title, a description and an image", (t) => {
  for (const property of ["og:title", "og:description", "og:image", "og:type", "og:site_name"]) {
    t.true(has("property", property), property);
  }
});

test("the image is an absolute URL, because a crawler has no page to resolve against", (t) => {
  t.regex(contentOf("property", "og:image"), /^https:\/\//);
});

test("the image's real dimensions are declared, so nothing crops the logo", (t) => {
  t.true(has("property", "og:image:width"));
  t.true(has("property", "og:image:height"));
});

test("no og:url is asserted", (t) => {
  // One static file serves every route, so any og:url would claim a tool link
  // is the homepage — and platforms that treat it as canonical would collapse
  // every shared tool into one preview, or send people to the wrong page.
  // Without it they fall back to the URL they actually fetched.
  t.false(has("property", "og:url"));
});

test("the card type matches the image's shape", (t) => {
  // A square image in summary_large_image is letterboxed and looks broken, so
  // these two have to agree. If a wide banner replaces the logo, this fails
  // until the card type is widened with it.
  const square =
    contentOf("property", "og:image:width") === contentOf("property", "og:image:height");
  t.is(contentOf("name", "twitter:card"), square ? "summary" : "summary_large_image");
});

test("the description says what Toolber is, not just its name", (t) => {
  // A preview whose description repeats the title tells a reader nothing they
  // did not already get from the link.
  const description = contentOf("property", "og:description");
  t.true(description.length > 30, description);
  t.not(description, contentOf("property", "og:title"));
});
