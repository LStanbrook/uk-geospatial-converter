/**
 * Irish Grid (EPSG:29902, TM65 / Irish Grid — the same Transverse Mercator
 * definition used for Northern Ireland OS mapping) <-> WGS84, and Irish
 * Grid Reference string parsing/formatting.
 *
 * Unlike the British National Grid, the Irish Grid covers the whole island
 * of Ireland with a single 500km x 500km lettered block (25 squares, A-Z
 * omitting I). Northern Ireland falls within a handful of those squares
 * (chiefly C, D, G, H, J) — e.g. Belfast is in square J ("J 337 749").
 *
 * We use proj4 for the projection + datum shift because the Irish Grid's
 * projection origin and ellipsoid (the "Ireland 1965" / modified Airy
 * ellipsoid) differ from Great Britain's, and proj4's towgs84 Helmert
 * parameters for Ireland are well established and give ~metre accuracy,
 * consistent with the OSGB36 approximation used for GB in osGridRef.js.
 */

const proj4 = require('proj4');

const IRISH_GRID_DEF =
  '+proj=tmerc +lat_0=53.5 +lon_0=-8 +k=1.000035 +x_0=200000 +y_0=250000 ' +
  '+ellps=mod_airy +towgs84=482.5,-130.6,564.6,-1.042,-0.214,-0.631,8.15 +units=m +no_defs';

proj4.defs('EPSG:29902', IRISH_GRID_DEF);

const WGS84 = 'EPSG:4326';
const IRISH_GRID = 'EPSG:29902';

// A-Z omitting 'I', laid out west->east, north->south in a 5x5 block.
const GRID_LETTERS = 'ABCDEFGHJKLMNOPQRSTUVWXYZ';

/** Irish Grid easting/northing (metres) -> WGS84 lat/lon. */
function irishGridToWgs84(easting, northing) {
  const [lon, lat] = proj4(IRISH_GRID, WGS84, [easting, northing]);
  return { lat, lon };
}

/** WGS84 lat/lon -> Irish Grid easting/northing (metres). */
function wgs84ToIrishGrid(lat, lon) {
  const [easting, northing] = proj4(WGS84, IRISH_GRID, [lon, lat]);
  return { easting, northing };
}

/**
 * Parse an Irish Grid Reference string, e.g. "J 335 745" or "J335745".
 * Returns { easting, northing, precision }, or null if unparseable.
 */
function parseIrishGridRef(input) {
  const compact = String(input).trim().toUpperCase().replace(/\s+/g, ' ');
  const match = compact.match(/^([A-HJ-Z])\s*([0-9\s]+)$/);
  if (!match) return null;

  const letterIndex = GRID_LETTERS.indexOf(match[1]);
  if (letterIndex === -1) return null;
  const col = letterIndex % 5; // west -> east
  const rowFromTop = Math.floor(letterIndex / 5);
  const e100km = col;
  const n100km = 4 - rowFromTop; // north -> south becomes south -> north

  const digitGroups = match[2].trim().split(/\s+/).filter(Boolean);
  let eDigits, nDigits;
  if (digitGroups.length >= 2) {
    eDigits = digitGroups[0];
    nDigits = digitGroups[1];
  } else {
    const digits = digitGroups[0] || '';
    if (digits.length % 2 !== 0 || digits.length === 0 || digits.length > 10) return null;
    const half = digits.length / 2;
    eDigits = digits.slice(0, half);
    nDigits = digits.slice(half);
  }
  if (eDigits.length !== nDigits.length) return null;

  const eOffset = Number((eDigits + '00000').slice(0, 5));
  const nOffset = Number((nDigits + '00000').slice(0, 5));
  const precision = Math.pow(10, 5 - eDigits.length);

  return {
    easting: e100km * 100000 + eOffset,
    northing: n100km * 100000 + nOffset,
    precision,
  };
}

/** Format an easting/northing pair as an Irish Grid Reference string, e.g. "J 337 749". */
function formatIrishGridRef(easting, northing, digitsPerAxis = 3) {
  if (easting < 0 || northing < 0 || easting >= 500000 || northing >= 500000) return null;

  const col = Math.floor(easting / 100000);
  const rowFromTop = 4 - Math.floor(northing / 100000);
  if (col < 0 || col > 4 || rowFromTop < 0 || rowFromTop > 4) return null;
  const letter = GRID_LETTERS[rowFromTop * 5 + col];

  const eRemainder = Math.floor(easting % 100000);
  const nRemainder = Math.floor(northing % 100000);
  const eStr = String(eRemainder).padStart(5, '0').slice(0, digitsPerAxis);
  const nStr = String(nRemainder).padStart(5, '0').slice(0, digitsPerAxis);

  return `${letter} ${eStr} ${nStr}`;
}

module.exports = {
  irishGridToWgs84,
  wgs84ToIrishGrid,
  parseIrishGridRef,
  formatIrishGridRef,
};
