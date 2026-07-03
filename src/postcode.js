/**
 * Postcode lookup, split by jurisdiction because the underlying open data
 * is split that way:
 *
 * - Great Britain (England/Scotland/Wales + Isle of Man/Channel Islands):
 *   we call the free postcodes.io API, which is itself built from ONSPD /
 *   Code-Point Open. No API key, no bulk download needed to get running.
 *   A `LocalCodePointOpenProvider` stub is included below showing how to
 *   swap in an offline Code-Point Open CSV for bulk/offline use.
 *
 * - Northern Ireland: postcodes.io does not carry NI unit postcodes (the
 *   authoritative dataset, LPS "Pointer", has separate licensing/
 *   distribution from ONSPD). We ship a small sample district-level lookup
 *   (data/ni-postcode-sample.json) so the app works out of the box, behind
 *   the same provider interface — swap it for a real Pointer CSV loader in
 *   production. See the README for details.
 */

const path = require('path');
const niSample = require(path.join('..', 'data', 'ni-postcode-sample.json'));

const POSTCODES_IO_BASE = 'https://api.postcodes.io';

function isNorthernIrelandPostcode(postcode) {
  return /^BT/i.test(postcode.trim());
}

function normalisePostcode(postcode) {
  return postcode.trim().toUpperCase().replace(/\s+/g, '');
}

function outwardCode(postcode) {
  const compact = normalisePostcode(postcode);
  // Outward code is everything except the last 3 characters for a full
  // postcode (digit + 2 letters); otherwise the whole thing is already
  // the outward/partial code.
  if (/^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/.test(compact)) {
    return compact.slice(0, -3);
  }
  return compact;
}

/** GB postcode lookup via postcodes.io (covers full or partial/outward codes). */
async function lookupGbPostcode(postcode) {
  const compact = normalisePostcode(postcode);
  const isFull = /\d[A-Z]{2}$/.test(compact) && compact.length >= 5;

  const url = isFull
    ? `${POSTCODES_IO_BASE}/postcodes/${encodeURIComponent(postcode.trim())}`
    : `${POSTCODES_IO_BASE}/outcodes/${encodeURIComponent(outwardCode(postcode))}`;

  const res = await fetch(url);
  if (!res.ok) return null;
  const body = await res.json();
  if (!body || body.status !== 200 || !body.result) return null;

  const r = body.result;
  return {
    lat: r.latitude,
    lon: r.longitude,
    postcode: r.postcode || outwardCode(postcode),
    region: r.admin_district || r.region || (r.admin_district_codes ? r.admin_district_codes[0] : null),
    country: r.country || null,
    source: 'postcodes.io',
  };
}

/** NI postcode lookup against the bundled sample dataset (district-level only). */
function lookupNiPostcode(postcode) {
  const district = outwardCode(postcode);
  const entry = district && niSample[district];
  if (!entry) return null;

  return {
    lat: entry.lat,
    lon: entry.lon,
    postcode: district,
    region: entry.district,
    country: 'Northern Ireland',
    source: 'sample-data (approximate district centroid — replace with LPS Pointer for production)',
  };
}

/** Unified postcode lookup: routes to GB (postcodes.io) or NI (sample data) by prefix. */
async function lookupPostcode(postcode) {
  if (isNorthernIrelandPostcode(postcode)) {
    return lookupNiPostcode(postcode);
  }
  try {
    return await lookupGbPostcode(postcode);
  } catch {
    return null;
  }
}

/** Reverse-geocode a WGS84 point to its nearest GB postcode (GB only — see class docs). */
async function nearestGbPostcode(lat, lon) {
  const url = `${POSTCODES_IO_BASE}/postcodes?lon=${lon}&lat=${lat}&limit=1`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const body = await res.json();
    const match = body?.result?.[0];
    if (!match) return null;
    return {
      postcode: match.postcode,
      region: match.admin_district,
      distanceMetres: match.distance,
    };
  } catch {
    return null;
  }
}

/**
 * Stub showing how to swap in an offline Code-Point Open CSV instead of
 * calling postcodes.io — useful for bulk conversion or air-gapped
 * deployments. Not wired up by default (no CSV is bundled).
 *
 * const fs = require('fs');
 * const { parse } = require('csv-parse/sync');
 * class LocalCodePointOpenProvider {
 *   constructor(csvPath) {
 *     const rows = parse(fs.readFileSync(csvPath), { columns: false });
 *     this.index = new Map(rows.map(r => [r[0].replace(/\s+/g, ''), r]));
 *   }
 *   lookup(postcode) {
 *     const row = this.index.get(normalisePostcode(postcode));
 *     if (!row) return null;
 *     const easting = Number(row[10]);
 *     const northing = Number(row[11]);
 *     // Code-Point Open eastings/northings are already OSGB36 — convert
 *     // with osGridRef.osGridToWgs84(easting, northing) for lat/lon.
 *     return { easting, northing };
 *   }
 * }
 */

module.exports = {
  lookupPostcode,
  lookupGbPostcode,
  lookupNiPostcode,
  nearestGbPostcode,
  isNorthernIrelandPostcode,
  normalisePostcode,
};
