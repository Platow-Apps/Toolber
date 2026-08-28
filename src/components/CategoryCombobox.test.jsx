import { useState } from "react";
import test from "ava";
import { cleanup, fireEvent, renderWithRouter, screen } from "../../test/setup.jsx";
import CategoryCombobox from "./CategoryCombobox.jsx";

test.afterEach(() => {
  cleanup();
});

function Controlled({ initial = { category: "", subcategory: "" }, onPick } = {}) {
  const [value, setValue] = useState(initial);
  return (
    <CategoryCombobox
      category={value.category}
      subcategory={value.subcategory}
      onChange={(next) => {
        setValue(next);
        onPick?.(next);
      }}
    />
  );
}

const searchBox = () => screen.getByPlaceholderText(/search e\.g\./i);

test.serial("shows a search box, not a selected value, when nothing is chosen", (t) => {
  renderWithRouter(<Controlled />);
  t.truthy(searchBox());
});

test.serial("opens the option list on focus", (t) => {
  renderWithRouter(<Controlled />);
  fireEvent.focus(searchBox());

  t.truthy(screen.getByRole("listbox"));
  t.truthy(screen.getByRole("option", { name: "Air & Compressed Air" }));
});

test.serial("finds a subcategory by its own name, without naming its parent", (t) => {
  // The whole point of wiring subcategories in: nobody should have to know
  // that "Brake & suspension service" lives under Automotive to find it.
  renderWithRouter(<Controlled />);
  const input = searchBox();
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "brake" } });

  const options = screen.getAllByRole("option");
  t.true(options.length > 0);
  t.true(options.every((o) => /brake/i.test(o.textContent)));
});

test.serial("narrows on every term, so two words are an AND not an OR", (t) => {
  renderWithRouter(<Controlled />);
  const input = searchBox();
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "automotive brake" } });

  const options = screen.getAllByRole("option");
  t.true(options.length > 0);
  t.true(options.every((o) => /automotive/i.test(o.textContent) && /brake/i.test(o.textContent)));
});

test.serial("shows a no-match state instead of an empty list", (t) => {
  renderWithRouter(<Controlled />);
  const input = searchBox();
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "zzzzz" } });

  t.truthy(screen.getByText(/no matching categories/i));
});

test.serial("reports both halves when a subcategory is picked", (t) => {
  let picked = null;
  renderWithRouter(<Controlled onPick={(v) => { picked = v; }} />);
  const input = searchBox();
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "air compressors" } });
  fireEvent.click(screen.getAllByRole("option")[0]);

  t.is(picked.category, "Air & Compressed Air");
  t.is(picked.subcategory, "Air compressors");
  // Reads back as the full path, and the search box is replaced.
  t.truthy(screen.getByText(/Air & Compressed Air — Air compressors/));
  t.is(screen.queryByPlaceholderText(/search e\.g\./i), null);
});

test.serial("allows a bare top-level category with no subcategory", (t) => {
  let picked = null;
  renderWithRouter(<Controlled onPick={(v) => { picked = v; }} />);
  fireEvent.focus(searchBox());
  fireEvent.click(screen.getByRole("option", { name: "Automotive" }));

  t.is(picked.category, "Automotive");
  t.is(picked.subcategory, "");
});

test.serial("clearing puts the search box back and empties both halves", (t) => {
  let picked = null;
  renderWithRouter(<Controlled initial={{ category: "Automotive", subcategory: "Body repair" }} onPick={(v) => { picked = v; }} />);

  fireEvent.click(screen.getByRole("button", { name: /clear category/i }));
  t.deepEqual(picked, { category: "", subcategory: "" });
  t.truthy(searchBox());
});

test.serial("Other is always selectable as a catch-all", (t) => {
  renderWithRouter(<Controlled />);
  const input = searchBox();
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "other" } });
  fireEvent.click(screen.getByRole("option", { name: "Other" }));

  t.truthy(screen.getByText("Other"));
});

test.serial("closes on Escape without selecting anything", (t) => {
  renderWithRouter(<Controlled />);
  fireEvent.focus(searchBox());
  t.truthy(screen.getByRole("listbox"));

  fireEvent.keyDown(document, { key: "Escape" });
  t.is(screen.queryByRole("listbox"), null);
});

// ── Holding & Fixturing, and spelling variants ──────────────────────────

test.serial("finds the holding and fixturing category", (t) => {
  renderWithRouter(<Controlled />);
  const input = searchBox();
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "holding" } });

  t.truthy(screen.getByRole("option", { name: "Holding & Fixturing" }));
});

test.serial("puts clamps and vises under one parent, not several", (t) => {
  // They used to be split across Pliers & Clamps and Tables & Benches, so
  // searching "clamp" listed the same kind of thing under two categories.
  renderWithRouter(<Controlled />);
  const input = searchBox();
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "clamps" } });

  const parents = new Set(
    screen.getAllByRole("option").map((o) => o.textContent.split("—")[0].trim())
  );
  t.false(parents.has("Pliers & Clamps"), "that category no longer exists");
});

test.serial("matches a vise when someone types vice", (t) => {
  // The taxonomy uses the US spelling; plenty of people write "vice" and
  // would otherwise get nothing at all.
  renderWithRouter(<Controlled />);
  const input = searchBox();
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "vice" } });

  const options = screen.getAllByRole("option");
  t.true(options.length > 0);
  t.true(options.some((o) => /vise/i.test(o.textContent)));
});

test.serial("matches a wrench when someone types spanner", (t) => {
  renderWithRouter(<Controlled />);
  const input = searchBox();
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "spanner" } });

  t.true(screen.getAllByRole("option").some((o) => /wrench/i.test(o.textContent)));
});
