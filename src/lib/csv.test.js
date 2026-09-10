import test from "ava";
import { csvField, toCsv } from "./csv";

const COLUMNS = [
  { key: "name", label: "Name" },
  { key: "email", label: "Email" },
];

test("a plain value is not quoted", (t) => {
  t.is(csvField("Jim B"), "Jim B");
});

test("a comma forces quoting — otherwise one name becomes two columns", (t) => {
  // The whole reason this is a function and not a join(","). "Jim B., Jr."
  // splits silently, and the spreadsheet opens without complaining.
  t.is(csvField("Jim B., Jr."), '"Jim B., Jr."');
});

test("an embedded quote is doubled, not escaped with a backslash", (t) => {
  t.is(csvField('Jim "Sparky" B'), '"Jim ""Sparky"" B"');
});

test("a newline is quoted rather than ending the row early", (t) => {
  t.is(csvField("line one\nline two"), '"line one\nline two"');
});

test("null and undefined are empty, not the words", (t) => {
  t.is(csvField(null), "");
  t.is(csvField(undefined), "");
});

test("zero and false survive, because they are values", (t) => {
  // `value || ""` would turn a genuine count of zero into a blank cell.
  t.is(csvField(0), "0");
  t.is(csvField(false), "false");
});

test("a document is a header row then one row per record, CRLF separated", (t) => {
  const csv = toCsv(COLUMNS, [
    { name: "Jim B", email: "jim@example.com" },
    { name: "Ana R", email: "ana@example.com" },
  ]);

  t.is(csv, "Name,Email\r\nJim B,jim@example.com\r\nAna R,ana@example.com");
});

test("columns decide what is exported — an extra field on the row is left out", (t) => {
  // The export must not quietly widen when the RPC starts returning more.
  const csv = toCsv(COLUMNS, [{ name: "Jim B", email: "jim@example.com", phone: "555-0101" }]);

  t.false(csv.includes("555-0101"));
});

test("a missing key becomes an empty cell rather than shifting the row", (t) => {
  t.is(toCsv(COLUMNS, [{ name: "Jim B" }]), "Name,Email\r\nJim B,");
});

test("no rows still produces the header, so the file is readable", (t) => {
  t.is(toCsv(COLUMNS, []), "Name,Email");
});
