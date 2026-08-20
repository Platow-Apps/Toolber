// Tool status presentation, in one place. These tables and the price format
// were previously copy-pasted into Search, MyTools, GroupDetail and Favorites,
// which is four chances for them to drift apart.

export const STATUS_STYLE = {
  available: "bg-[#E9F3E9] text-[#2E6B2E]",
  requested: "bg-[#FCF1D6] text-[#8A6300]",
  borrowed: "bg-[#EEECE8] text-steel",
  unavailable_malfunction: "bg-[#FCEBEB] text-signal",
};

export const STATUS_LABEL = {
  available: "Available",
  requested: "Requested",
  borrowed: "Borrowed",
  unavailable_malfunction: "Malfunction",
};

export const REQUEST_STATE_STYLE = {
  pending: "bg-[#FCF1D6] text-[#8A6300]",
  approved: "bg-[#E9F3E9] text-[#2E6B2E]",
  denied: "bg-[#FCEBEB] text-signal",
  completed: "bg-[#EEECE8] text-steel",
  cancelled: "bg-[#EEECE8] text-steel",
};

export function statusStyle(status) {
  return STATUS_STYLE[status] ?? "";
}

export function statusLabel(status) {
  return STATUS_LABEL[status] ?? status;
}

const DURATION_LABEL = {
  hour: "hour",
  half_day: "half day",
  day: "day",
  week: "week",
  month: "month",
};

const CURRENCY = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/**
 * "Free", or a formatted rate like "$12.50/half day".
 *
 * Note the missing-unit case renders as a bare amount rather than silently
 * claiming "/day" — a null unit is a data problem, not a default.
 */
export function formatPrice(tool) {
  if (!tool?.monetize) return "Free";
  if (tool.price == null) return "Price not set";
  const amount = CURRENCY.format(Number(tool.price));
  const unit = DURATION_LABEL[tool.price_duration_unit];
  return unit ? `${amount}/${unit}` : amount;
}

/** Tailwind colour for a price string — muted gold when paid, green when free. */
export function priceClass(tool) {
  return tool?.monetize ? "text-[#8B6F1F]" : "text-[#3B7A3F]";
}
