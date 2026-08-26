import { useState } from "react";
import test from "ava";
import { cleanup, fireEvent, renderWithRouter, screen } from "../../test/setup.jsx";
import CategoryCombobox from "./CategoryCombobox.jsx";

test.afterEach(() => {
  cleanup();
});

function Controlled({ initial = "" }) {
  const [value, setValue] = useState(initial);
  return <CategoryCombobox value={value} onChange={setValue} />;
}

test.serial("shows a search box, not a selected value, when nothing is chosen", (t) => {
  renderWithRouter(<Controlled />);
  t.truthy(screen.getByPlaceholderText(/search categories/i));
});

test.serial("opens the option list on focus and lists real categories", (t) => {
  renderWithRouter(<Controlled />);
  fireEvent.focus(screen.getByPlaceholderText(/search categories/i));

  t.truthy(screen.getByRole("option", { name: "Power Tools" }));
  t.truthy(screen.getByRole("option", { name: "Other" }));
});

test.serial("filters options as you type", (t) => {
  renderWithRouter(<Controlled />);
  const input = screen.getByPlaceholderText(/search categories/i);
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "weld" } });

  t.truthy(screen.getByRole("option", { name: "Welding & Metal Fab" }));
  t.is(screen.queryByRole("option", { name: "Power Tools" }), null);
});

test.serial("shows a no-match state instead of an empty list", (t) => {
  renderWithRouter(<Controlled />);
  const input = screen.getByPlaceholderText(/search categories/i);
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "zzzzz" } });

  t.truthy(screen.getByText(/no matching categories/i));
});

test.serial("picking an option shows it as the selected value with a clear control", (t) => {
  renderWithRouter(<Controlled />);
  fireEvent.focus(screen.getByPlaceholderText(/search categories/i));
  fireEvent.click(screen.getByRole("option", { name: "Wrenches" }));

  t.truthy(screen.getByText("Wrenches"));
  t.is(screen.queryByPlaceholderText(/search categories/i), null);

  fireEvent.click(screen.getByRole("button", { name: /clear category/i }));
  t.truthy(screen.getByPlaceholderText(/search categories/i));
});

test.serial("Other is always selectable as a catch-all", (t) => {
  renderWithRouter(<Controlled />);
  fireEvent.focus(screen.getByPlaceholderText(/search categories/i));
  fireEvent.click(screen.getByRole("option", { name: "Other" }));

  t.truthy(screen.getByText("Other"));
});

test.serial("closes on Escape without selecting anything", (t) => {
  renderWithRouter(<Controlled />);
  fireEvent.focus(screen.getByPlaceholderText(/search categories/i));
  t.truthy(screen.getByRole("listbox"));

  fireEvent.keyDown(document, { key: "Escape" });
  t.is(screen.queryByRole("listbox"), null);
});
