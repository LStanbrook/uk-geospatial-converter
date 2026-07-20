/**
 * British National Grid (OSGB36) <-> lat/lon, and OS Grid Reference string
 * parsing/formatting.
 *
 * The lat/lon <-> easting/northing maths is the classic Redfearn / Transverse
 * Mercator projection formulae as published by Ordnance Survey in
 * "A guide to coordinate systems in Great Britain" (Annex C). These
 * formulae operate entirely within the OSGB36 datum on the Airy 1830
 * ellipsoid; converting to/from WGS84 is a separate Helmert transform step
 * (see ellipsoids.js / helmert.js) applied by the wrapper functions below.
 */

const { ELLIPSOIDS, WGS84_TO_OSGB36, OSGB36_TO_WGS84 } = require('./ellipsoids');
const { transformDatum } = require('./helmert');

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

// National Grid true origin and projection constants.
const A = ELLIPSOIDS.AIRY_1830.a;
const B = ELLIPSOIDS.AIRY_1830.b;
const F0 = 0.9996012717; // scale factor on central meridian
const PHI0 = 49 * DEG2RAD; // true origin latitude
const LAMBDA0 = -2 * DEG2RAD; // true origin longitude
const N0 = -100000; // true origin northing
const E0 = 400000; // true origin easting
const E2 = 1 - (B * B) / (A * A); // eccentricity squared
const N = (A - B) / (A + B);
const N2 = N * N;
const N3 = N * N * N;

/** OSGB36 lat/lon (degrees) -> British National Grid easting/northing (metres). */
function latLonToOsGrid(lat, lon) {
  const phi = lat * DEG2RAD;
  const lambda = lon * DEG2RAD;

  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  const nu = (A * F0) / Math.sqrt(1 - E2 * sinPhi * sinPhi);
  const rho = (A * F0 * (1 - E2)) / Math.pow(1 - E2 * sinPhi * sinPhi, 1.5);
  const eta2 = nu / rho - 1;

  const Ma = (1 + N + (5 / 4) * N2 + (5 / 4) * N3) * (phi - PHI0);
  const Mb = (3 * N + 3 * N2 + (21 / 8) * N3) * Math.sin(phi - PHI0) * Math.cos(phi + PHI0);
  const Mc = ((15 / 8) * N2 + (15 / 8) * N3) * Math.sin(2 * (phi - PHI0)) * Math.cos(2 * (phi + PHI0));
  const Md = (35 / 24) * N3 * Math.sin(3 * (phi - PHI0)) * Math.cos(3 * (phi + PHI0));
  const M = B * F0 * (Ma - Mb + Mc - Md);

  const cos3Phi = cosPhi * cosPhi * cosPhi;
  const cos5Phi = cos3Phi * cosPhi * cosPhi;
  const tanPhi = Math.tan(phi);
  const tan2Phi = tanPhi * tanPhi;
  const tan4Phi = tan2Phi * tan2Phi;

  const I = M + N0;
  const II = (nu / 2) * sinPhi * cosPhi;
  const III = (nu / 24) * sinPhi * cos3Phi * (5 - tan2Phi + 9 * eta2);
  const IIIA = (nu / 720) * sinPhi * cos5Phi * (61 - 58 * tan2Phi + tan4Phi);
  const IV = nu * cosPhi;
  const V = (nu / 6) * cos3Phi * (nu / rho - tan2Phi);
  const VI = (nu / 120) * cos5Phi * (5 - 18 * tan2Phi + tan4Phi + 14 * eta2 - 58 * tan2Phi * eta2);

  const dLambda = lambda - LAMBDA0;
  const dLambda2 = dLambda * dLambda;
  const dLambda3 = dLambda2 * dLambda;
  const dLambda4 = dLambda3 * dLambda;
  const dLambda5 = dLambda4 * dLambda;
  const dLambda6 = dLambda5 * dLambda;

  const northing = I + II * dLambda2 + III * dLambda4 + IIIA * dLambda6;
  const easting = E0 + IV * dLambda + V * dLambda3 + VI * dLambda5;

  return { easting, northing };
}

/** British National Grid easting/northing (metres) -> OSGB36 lat/lon (degrees). */
function osGridToLatLon(easting, northing) {
  let phi = PHI0;
  let M = 0;

  do {
    phi = (northing - N0 - M) / (A * F0) + phi;

    const Ma = (1 + N + (5 / 4) * N2 + (5 / 4) * N3) * (phi - PHI0);
    const Mb = (3 * N + 3 * N2 + (21 / 8) * N3) * Math.sin(phi - PHI0) * Math.cos(phi + PHI0);
    const Mc = ((15 / 8) * N2 + (15 / 8) * N3) * Math.sin(2 * (phi - PHI0)) * Math.cos(2 * (phi + PHI0));
    const Md = (35 / 24) * N3 * Math.sin(3 * (phi - PHI0)) * Math.cos(3 * (phi + PHI0));
    M = B * F0 * (Ma - Mb + Mc - Md);
  } while (Math.abs(northing - N0 - M) >= 0.00001);

  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  const tanPhi = Math.tan(phi);
  const secPhi = 1 / cosPhi;

  const nu = (A * F0) / Math.sqrt(1 - E2 * sinPhi * sinPhi);
  const rho = (A * F0 * (1 - E2)) / Math.pow(1 - E2 * sinPhi * sinPhi, 1.5);
  const eta2 = nu / rho - 1;

  const tan2Phi = tanPhi * tanPhi;
  const tan4Phi = tan2Phi * tan2Phi;
  const tan6Phi = tan4Phi * tan2Phi;
  const nu3 = nu * nu * nu;
  const nu5 = nu3 * nu * nu;
  const nu7 = nu5 * nu * nu;

  const VII = tanPhi / (2 * rho * nu);
  const VIII = (tanPhi / (24 * rho * nu3)) * (5 + 3 * tan2Phi + eta2 - 9 * tan2Phi * eta2);
  const IX = (tanPhi / (720 * rho * nu5)) * (61 + 90 * tan2Phi + 45 * tan4Phi);
  const X = secPhi / nu;
  const XI = (secPhi / (6 * nu3)) * (nu / rho + 2 * tan2Phi);
  const XII = (secPhi / (120 * nu5)) * (5 + 28 * tan2Phi + 24 * tan4Phi);
  const XIIA = (secPhi / (5040 * nu7)) * (61 + 662 * tan2Phi + 1320 * tan4Phi + 720 * tan6Phi);

  const dE = easting - E0;
  const dE2 = dE * dE;
  const dE3 = dE2 * dE;
  const dE4 = dE2 * dE2;
  const dE5 = dE4 * dE;
  const dE6 = dE4 * dE2;
  const dE7 = dE6 * dE;

  phi = phi - VII * dE2 + VIII * dE4 - IX * dE6;
  const lambda = LAMBDA0 + X * dE - XI * dE3 + XII * dE5 - XIIA * dE7;

  return { lat: phi * RAD2DEG, lon: lambda * RAD2DEG };
}

// --- Grid letters ---------------------------------------------------------
// The National Grid divides GB into 500km squares, each split into a 5x5
// grid of 100km squares, lettered A-Z (omitting I). This is the same
// two-letter-prefix scheme printed on OS Landranger/Explorer maps.

/** Given the two grid letters, return the SW corner of the 100km square (metres, from false origin). */
function gridLettersTo100km(l1, l2) {
  let i1 = l1.charCodeAt(0) - 65; // 'A' = 0
  let i2 = l2.charCodeAt(0) - 65;
  if (i1 > 7) i1--; // letters after 'I' shift down by one (I is skipped)
  if (i2 > 7) i2--;

  const e100km = ((i1 - 2) % 5) * 5 + (i2 % 5);
  const n100km = 19 - Math.floor(i1 / 5) * 5 - Math.floor(i2 / 5);

  return { e100km, n100km };
}

/** Inverse of gridLettersTo100km: 100km square indices -> two grid letters. */
function en100kmToGridLetters(e100km, n100km) {
  // Inverting the false-origin offset algebraically is error-prone, so
  // brute-force the 25x25 letter space instead (cheap, and unambiguous).
  for (let a = 0; a < 25; a++) {
    for (let b = 0; b < 25; b++) {
      let ia = a >= 8 ? a + 1 : a; // re-insert the 'I' gap
      let ib = b >= 8 ? b + 1 : b;
      const l1 = String.fromCharCode(65 + ia);
      const l2 = String.fromCharCode(65 + ib);
      const test = gridLettersTo100km(l1, l2);
      if (test.e100km === e100km && test.n100km === n100km) {
        return l1 + l2;
      }
    }
  }
  return null;
}

/**
 * Parse an OS Grid Reference string, e.g. "NT 257 735" or "TQ2880".
 * Returns { easting, northing, precision } (precision = metres represented
 * by the least-significant digit), or null if it cannot be parsed.
 */
function parseGridRef(input) {
  const compact = String(input).trim().toUpperCase().replace(/\s+/g, ' ');
  const match = compact.match(/^([A-HJ-Z]{2})\s*([0-9\s]+)$/);
  if (!match) return null;

  const [l1, l2] = match[1].split('');
  const { e100km, n100km } = gridLettersTo100km(l1, l2);
  if (e100km < 0 || e100km > 6 || n100km < 0 || n100km > 12) return null; // outside GB extent

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

  // Pad on the right with zeros to give a 5-digit (1m resolution) offset
  // within the 100km square, e.g. "51" -> "51000" (1km precision).
  const eOffset = Number((eDigits + '00000').slice(0, 5));
  const nOffset = Number((nDigits + '00000').slice(0, 5));
  const precision = Math.pow(10, 5 - eDigits.length);

  return {
    easting: e100km * 100000 + eOffset,
    northing: n100km * 100000 + nOffset,
    precision,
  };
}

/** Format an easting/northing pair as an OS Grid Reference string, e.g. "NT 257 735". */
function formatGridRef(easting, northing, digitsPerAxis = 3) {
  if (easting < 0 || northing < 0 || easting >= 700000 || northing >= 1300000) return null;

  const e100km = Math.floor(easting / 100000);
  const n100km = Math.floor(northing / 100000);
  const letters = en100kmToGridLetters(e100km, n100km);
  if (!letters) return null;

  const eRemainder = Math.floor(easting % 100000);
  const nRemainder = Math.floor(northing % 100000);
  const eStr = String(eRemainder).padStart(5, '0').slice(0, digitsPerAxis);
  const nStr = String(nRemainder).padStart(5, '0').slice(0, digitsPerAxis);

  return `${letters} ${eStr} ${nStr}`;
}

/** OSGB36 easting/northing -> WGS84 lat/lon. */
function osGridToWgs84(easting, northing) {
  const osgb36 = osGridToLatLon(easting, northing);
  return transformDatum(osgb36.lat, osgb36.lon, ELLIPSOIDS.AIRY_1830, ELLIPSOIDS.WGS84, OSGB36_TO_WGS84);
}

/** WGS84 lat/lon -> OSGB36 easting/northing. */
function wgs84ToOsGrid(lat, lon) {
  const osgb36 = transformDatum(lat, lon, ELLIPSOIDS.WGS84, ELLIPSOIDS.AIRY_1830, WGS84_TO_OSGB36);
  return latLonToOsGrid(osgb36.lat, osgb36.lon);
}

module.exports = {
  latLonToOsGrid,
  osGridToLatLon,
  parseGridRef,
  formatGridRef,
  osGridToWgs84,
  wgs84ToOsGrid,
};
