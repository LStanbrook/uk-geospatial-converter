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
const { byLad: ITL_BY_LAD, byName: ITL_BY_LAD_NAME } = require(path.join('..', 'data', 'itl-lookup.json'));

const POSTCODES_IO_BASE = 'https://api.postcodes.io';

/** Unique, non-null values across several ITL lookups, joined for display (e.g. "Wandsworth / Westminster"). */
function mergeItlLevel(entries, level) {
  const values = [...new Set(entries.map((e) => e[level]).filter(Boolean))];
  return values.length ? values.join(' / ') : null;
}

/**
 * Derives ITL1/ITL2/ITL3 area names from a postcode's Local Authority
 * District (LAD) GSS code (e.g. postcodes.io's codes.admin_district,
 * "W06000015") plus its name(s) as a fallback. Deliberately not keyed by
 * postcodes.io's own codes.nuts — that field turned out to be a different
 * vintage/numbering to the ONS lookup data/itl-lookup.json was built from
 * for Scotland and Wales (code-prefix matching silently produced wrong or
 * missing ITL2 names, e.g. Cardiff/Edinburgh), even though ITL1 happened to
 * still resolve. LAD GSS codes agree far more often, but can still drift
 * between vintages (observed for Sheffield), so an exact-code miss falls
 * back to a name match — LAD names are the most stable identifier of the three.
 *
 * `ladName` may be a single name (full postcodes) or an *array* of names —
 * postcodes.io's /outcodes/ endpoint (partial postcodes) returns
 * admin_district as an array when the outward code spans several districts,
 * with no GSS code at all. Each level is merged independently: a partial
 * postcode straddling Wandsworth and Westminster still resolves a single
 * ITL1/ITL2 ("London" / "Inner London - West") since both districts share
 * those, only ITL3 shows the straddle ("Wandsworth / Westminster").
 */
function itlFromLad(ladCode, ladName) {
  if (ladCode && ITL_BY_LAD[ladCode]) {
    const entry = ITL_BY_LAD[ladCode];
    return { itl1: entry.itl1, itl2: entry.itl2, itl3: entry.itl3 };
  }

  const names = Array.isArray(ladName) ? ladName : ladName ? [ladName] : [];
  const entries = names.map((n) => ITL_BY_LAD_NAME[n.toLowerCase()]).filter(Boolean);
  if (!entries.length) return { itl1: null, itl2: null, itl3: null };

  return {
    itl1: mergeItlLevel(entries, 'itl1'),
    itl2: mergeItlLevel(entries, 'itl2'),
    itl3: mergeItlLevel(entries, 'itl3'),
  };
}

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
  const { itl1, itl2, itl3 } = itlFromLad(r.codes?.admin_district, r.admin_district);
  return {
    lat: r.latitude,
    lon: r.longitude,
    postcode: r.postcode || outwardCode(postcode),
    itl1,
    itl2,
    itl3,
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
    // NI has no ITL2 subdivision — ITL1 and ITL2 are both simply "Northern
    // Ireland", with ITL3 splitting into its 11 local government districts.
    itl1: 'Northern Ireland',
    itl2: 'Northern Ireland',
    itl3: entry.district,
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
    const { itl1, itl2, itl3 } = itlFromLad(match.codes?.admin_district, match.admin_district);
    return {
      postcode: match.postcode,
      itl1,
      itl2,
      itl3,
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
