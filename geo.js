// Haversine distance between two lat/lng points, in meters.
export function distanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Given a list of company locations, find the nearest one that the
// supplied coordinate falls within. Returns { location, distance } or null.
export function matchLocation(locations, lat, lng) {
  let best = null;
  for (const loc of locations) {
    const d = distanceMeters(lat, lng, loc.latitude, loc.longitude);
    if (d <= loc.radius_meters && (!best || d < best.distance)) {
      best = { location: loc, distance: d };
    }
  }
  return best;
}

// Deterministic shift rotation: given a user's rotation config and a target
// date, works out which shift they are on without needing to write a row
// for every future day.
export function computeRotatingShift(user, dateStr) {
  if (!user.rotation_shift_ids || !user.rotation_start_date) return null;
  let shiftIds;
  try {
    shiftIds = JSON.parse(user.rotation_shift_ids);
  } catch {
    return null;
  }
  if (!Array.isArray(shiftIds) || shiftIds.length === 0) return null;

  const intervalDays = user.rotation_interval_days || 7;
  const start = new Date(user.rotation_start_date + "T00:00:00Z");
  const target = new Date(dateStr + "T00:00:00Z");
  const daysSince = Math.floor((target - start) / 86400000);
  if (daysSince < 0) return shiftIds[0];

  const legIndex = Math.floor(daysSince / intervalDays) % shiftIds.length;
  return shiftIds[legIndex];
}

export function todayStr(tz = "UTC") {
  return new Date().toLocaleDateString("en-CA", { timeZone: tz }); // YYYY-MM-DD
}
