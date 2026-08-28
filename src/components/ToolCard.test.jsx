import test from "ava";
import { cleanup, renderWithRouter, setSupabaseMock } from "../../test/setup.jsx";
import ToolCard from "./ToolCard.jsx";

test.beforeEach(() => {
  setSupabaseMock({
    storage: (bucket) => ({
      getPublicUrl(path) {
        return { data: { publicUrl: `https://cdn.test/${bucket}/${path}` } };
      },
    }),
  });
});

test.afterEach(() => {
  cleanup();
});

const TOOL = { id: "tool-1", name: "Ladder", status: "available", monetize: false, price: null, price_duration_unit: null };

test.serial("falls back to the toolbox icon with no photos", (t) => {
  const { container } = renderWithRouter(<ToolCard tool={TOOL} />);
  t.is(container.querySelector("img"), null);
});

test.serial("shows the first photo as a thumbnail when the tool has one", (t) => {
  const { container } = renderWithRouter(<ToolCard tool={{ ...TOOL, photos: ["user-1/a.jpg", "user-1/b.jpg"] }} />);

  // The 320px thumbnail, not the 1600px original — a list of results used to
  // download the full image once per row to render it at 44px.
  const img = container.querySelector("img");
  t.is(img.src, "https://cdn.test/tool-photos/user-1/a.thumb.jpg");
  t.is(img.getAttribute("loading"), "lazy");
});

// ── Layering (regression) ───────────────────────────────────────────────
// A dropdown passed as `action` has to escape the card's bounds. Two things
// on the card container used to stop it: clip-path clips every descendant,
// and opacity below 1 creates a stacking context that traps a child z-index.
// Both now live on inner layers instead.

const cardRoot = (container) => container.firstChild;

test.serial("never clips the container that holds the action", (t) => {
  const { container } = renderWithRouter(
    <ToolCard tool={TOOL} action={<button type="button">menu</button>} />
  );

  t.is(cardRoot(container).style.clipPath, "", "clip-path would truncate an open menu");
  // The motif itself is still drawn, just on a layer of its own behind the row.
  const surface = container.querySelector("span[aria-hidden='true']");
  t.true(surface.style.clipPath.startsWith("polygon("));
});

test.serial("never dims the container that holds the action", (t) => {
  const { container } = renderWithRouter(
    <ToolCard
      tool={{ ...TOOL, status: "borrowed" }}
      action={<button type="button">menu</button>}
    />
  );

  // opacity-60 here would trap the dropdown's z-index inside the card.
  t.false(cardRoot(container).className.includes("opacity-60"));
  t.true(container.querySelector("span[aria-hidden='true']").className.includes("opacity-60"));
});

test.serial("still fades a borrowed tool's content", (t) => {
  const { container } = renderWithRouter(<ToolCard tool={{ ...TOOL, status: "borrowed" }} />);
  t.true(container.innerHTML.includes("opacity-60"));
});

test.serial("fades a listing the owner has paused", (t) => {
  const { container } = renderWithRouter(<ToolCard tool={TOOL} dimmed />);
  t.true(container.innerHTML.includes("opacity-60"));
});

test.serial("leaves an ordinary available tool at full opacity", (t) => {
  const { container } = renderWithRouter(<ToolCard tool={TOOL} />);
  t.false(container.innerHTML.includes("opacity-60"));
});
