/**
 * CSV serialisation for the admin console's export.
 *
 * Split out of the page because the escaping is the part that goes wrong, and
 * a pure function is the only part of an export that can be unit-tested. A
 * display name containing a comma, a quote or a line break is not exotic --
 * "Jim B., Jr." breaks a naive join(",") into two columns silently, and the
 * spreadsheet opens without complaint.
 */

/**
 * One CSV field, quoted only when it has to be.
 *
 * RFC 4180: wrap in double quotes if the value contains a comma, a quote or a
 * newline, and double any quote inside. Null and undefined become empty rather
 * than the strings "null"/"undefined", which is what a spreadsheet expects for
 * a missing value.
 */
export function csvField(value) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/**
 * Rows to a CSV document.
 *
 * @param {Array<{key: string, label: string}>} columns  order and headings
 * @param {Array<object>} rows
 * @returns {string} CRLF-separated, per RFC 4180 — Excel is the likeliest
 *   destination and it is the fussiest about this.
 */
export function toCsv(columns, rows) {
  const lines = [columns.map((c) => csvField(c.label)).join(",")];
  for (const row of rows) {
    lines.push(columns.map((c) => csvField(row[c.key])).join(","));
  }
  return lines.join("\r\n");
}

/**
 * Hand a CSV to the browser as a file.
 *
 * The BOM is not decoration: without it Excel reads UTF-8 as the system code
 * page, and any non-ASCII name arrives mangled. Every other consumer ignores
 * it.
 */
export function downloadCsv(filename, text, doc = typeof document === "undefined" ? null : document) {
  if (!doc) return false;
  const blob = new Blob(["﻿", text], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = doc.createElement("a");
  link.href = url;
  link.download = filename;
  doc.body.appendChild(link);
  link.click();
  doc.body.removeChild(link);
  // Revoked on the next tick rather than immediately: Safari has been known to
  // cancel a download whose blob URL disappears while it is still starting.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
