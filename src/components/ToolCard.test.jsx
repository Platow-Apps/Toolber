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

  const img = container.querySelector("img");
  t.is(img.src, "https://cdn.test/tool-photos/user-1/a.jpg");
});
