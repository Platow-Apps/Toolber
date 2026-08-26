// The real category list, replacing the 9 placeholder guesses
// (Power/Hand/Yard/Ladder/Paint/Garden/Electrical/Measure/Cutting) that
// docs/feature-checklist.md flagged as "waiting on the user for the actual
// category list." Source: Tool Categories/garage_tool_categories.csv, which
// also carries ~380 subcategories -- those aren't wired in anywhere (see the
// category-vs-subcategory decision in this session's history); `tools`
// still has a single free-text `category` column, and these are exactly the
// values it's populated with, same as the old placeholder list.
//
// Order matches the source file's category_order column.
export const TOOL_CATEGORIES = [
  "Air & Compressed Air",
  "Automotive",
  "Bicycle",
  "Chemicals & Consumables",
  "Cleaning",
  "Craft",
  "Electrical",
  "Electronic",
  "Fasteners",
  "Fishing",
  "Fitness",
  "Garage Door",
  "Hammers",
  "Ladders",
  "Lawn & Garden",
  "Lighting",
  "Livestock & Pet",
  "Machining",
  "Material Handling",
  "Materials",
  "Measurement",
  "Outdoor Living",
  "Paint & Finishing",
  "Pliers & Clamps",
  "Plumbing",
  "Power Tools",
  "Rope & Cable",
  "Safety & PPE",
  "Saws & Blades",
  "Screwdrivers",
  "Shelves & Cabinets",
  "Sporting",
  "Storage",
  "Tables & Benches",
  "Welding & Metal Fab",
  "Wood & Carpentry",
  "Wrenches",
];
