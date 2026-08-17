// Straight-line distance in miles between two lat/lng points (haversine formula).
// Used for "Find a Group" proximity sort against each user/group's persisted
// approx_lat/lng — see docs/technical-design.md → Location & Privacy Model.
// Returns null if either point is missing (e.g. the user hid their location).
export function distanceMiles(lat1, lng1, lat2, lng2) {
  if ([lat1, lng1, lat2, lng2].some((v) => v == null)) return null;
  const R = 3958.8; // Earth radius in miles
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function formatDistance(miles) {
  if (miles == null) return null;
  if (miles < 0.1) return "Nearby";
  return `${miles.toFixed(1)} mi away`;
}
