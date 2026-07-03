/**
 * Detects which of the supported input types a pasted line represents:
 *   - postcode_full     "SW1A 1AA"
 *   - postcode_partial   "SW1A", "M1", "BT1"
 *   - os_grid             "NT 257 735", "TQ2880"
 *   - irish_grid          "J 335 745"
 *   - easting_northing     "437295, 115541"   (OSGB36)
 *   - latlon                "51.5074, -0.1278" (WGS84)
 *
 * The formats are not fully unambiguous as bare strings (a two-letter,
 * two-digit token like "TQ28" is syntactically both a valid 10km OS grid
 * square AND a valid partial postcode district). Real-world pasted lists
 * are overwhelmingly more likely to contain postcodes than coarse
 * (10km-precision) grid references, so as a deliberate, documented
 * heuristic: 2-digit letter+digit tokens are treated as postcodes, and
 * grid references are only inferred unambiguously once there are 4+
 * digits (1km precision or finer), which no UK postcode format produces.
 */

const FULL_POSTCODE_RE = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/;
const PARTIAL_POSTCODE_RE = /^[A-Z]{1,2}\d[A-Z\d]?$/;
const GRID_LETTER = '[A-HJ-Z]'; // excludes 'I', which neither grid system uses

const TYPES = {
  POSTCODE_FULL: 'postcode_full',
  POSTCODE_PARTIAL: 'postcode_partial',
  OS_GRID: 'os_grid',
  IRISH_GRID: 'irish_grid',
  EASTING_NORTHING: 'easting_northing',
  LATLON: 'latlon',
  UNKNOWN: 'unknown',
};

function detectType(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;

  const compact = s.toUpperCase().replace(/\s+/g, '');

  if (FULL_POSTCODE_RE.test(compact)) return TYPES.POSTCODE_FULL;

  // Lat/Lon: two decimal numbers (at least one with a decimal point),
  // separated by a comma and/or whitespace, within valid world ranges.
  const latLonMatch = s.match(/^(-?\d{1,3}\.\d+)\s*[, ]\s*(-?\d{1,3}\.\d+)$/);
  if (latLonMatch) {
    const lat = parseFloat(latLonMatch[1]);
    const lon = parseFloat(latLonMatch[2]);
    if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) return TYPES.LATLON;
  }

  // Irish Grid: 1 letter + even digit count. See heuristic note above —
  // only treated as a grid ref once there are 4+ digits.
  const irishMatch = compact.match(new RegExp(`^(${GRID_LETTER})(\\d{2,10})$`));
  if (irishMatch && irishMatch[2].length % 2 === 0 && irishMatch[2].length >= 4) {
    return TYPES.IRISH_GRID;
  }

  // OS Grid Reference: 2 letters + even digit count, 4+ digits unambiguous;
  // exactly 2 digits only accepted if the letter pair is a plausible GB
  // 100km grid square (keeps things like "TQ28" working while still
  // preferring postcode interpretation for arbitrary letter pairs).
  const gridMatch = compact.match(new RegExp(`^(${GRID_LETTER}{2})(\\d{2,10})$`));
  if (gridMatch && gridMatch[2].length % 2 === 0) {
    const digitCount = gridMatch[2].length;
    if (digitCount >= 4) return TYPES.OS_GRID;
    if (digitCount === 2 && isPlausibleGbSquare(gridMatch[1])) return TYPES.OS_GRID;
  }

  if (PARTIAL_POSTCODE_RE.test(compact)) return TYPES.POSTCODE_PARTIAL;

  // Easting/Northing (OSGB36): two plain numbers, no letters, within GB's
  // grid extent.
  const enMatch = s.match(/^(\d{3,7}(?:\.\d+)?)\s*[, ]\s*(\d{3,7}(?:\.\d+)?)$/);
  if (enMatch) {
    const e = parseFloat(enMatch[1]);
    const n = parseFloat(enMatch[2]);
    if (e >= 0 && e <= 800000 && n >= 0 && n <= 1300000) return TYPES.EASTING_NORTHING;
  }

  return TYPES.UNKNOWN;
}

/** Cheap bounding-box plausibility check for a GB 100km grid square letter pair. */
function isPlausibleGbSquare(letters) {
  let i1 = letters.charCodeAt(0) - 65;
  let i2 = letters.charCodeAt(1) - 65;
  if (i1 > 7) i1--;
  if (i2 > 7) i2--;
  const e100km = ((i1 - 2) % 5) * 5 + (i2 % 5);
  const n100km = 19 - Math.floor(i1 / 5) * 5 - Math.floor(i2 / 5);
  return e100km >= 0 && e100km <= 6 && n100km >= 0 && n100km <= 12;
}

module.exports = { detectType, TYPES };
