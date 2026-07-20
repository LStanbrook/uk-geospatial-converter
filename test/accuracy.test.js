const test = require('node:test');
const assert = require('node:assert/strict');

const osGrid = require('../src/osGridRef');
const irishGrid = require('../src/irishGrid');

/**
 * Ground-truth fixtures for OSGB36 <-> WGS84 accuracy, captured from
 * postcodes.io (itself sourced from ONS/OS's ONSPD) — i.e. real,
 * independently-surveyed (lat, lon) <-> (easting, northing) pairs for the
 * same physical address, not values our own code produced. Chosen to
 * spread across the grid: London, Edinburgh, Cardiff, Swansea, Manchester,
 * Newcastle, Cornwall (far west/low easting), Orkney and Shetland (far
 * north/high northing, separate 100km squares from the mainland).
 *
 * Tolerance: OS's own guide ("A guide to coordinate systems in Great
 * Britain", Annex B) states the 7-parameter Helmert approximation used here
 * (as opposed to the cm-accurate but much heavier OSTN15 grid-shift model)
 * is accurate to a few metres, worst-case up to ~5m. 7m gives headroom
 * against that without being loose enough to hide a real regression — a
 * sign/scale/parameter bug reliably produces errors of hundreds of metres
 * or more, nowhere near this boundary.
 */
const GROUND_TRUTH = [
  { postcode: 'SW1A 1AA', lat: 51.50101, lon: -0.141563, easting: 529090, northing: 179645 },
  { postcode: 'EH1 2NG', lat: 55.948961, lon: -3.201479, easting: 325066, northing: 673533 },
  { postcode: 'CF10 3NP', lat: 51.485631, lon: -3.177225, easting: 318356, northing: 176955 },
  { postcode: 'TR26 1SD', lat: 50.211789, lon: -5.480898, easting: 151752, northing: 40443 },
  { postcode: 'KW15 1NX', lat: 58.98208, lon: -2.95977, easting: 344930, northing: 1010945 },
  { postcode: 'ZE1 0LZ', lat: 60.158927, lon: -1.146156, easting: 447498, northing: 1141911 },
  { postcode: 'M16 0GB', lat: 53.454514, lon: -2.275496, easting: 381803, northing: 395340 },
  { postcode: 'SA3 5QF', lat: 51.58009, lon: -4.008693, easting: 260916, northing: 188715 },
  { postcode: 'PL25 5FE', lat: 50.343513, lon: -4.824469, easting: 199133, northing: 53105 },
  { postcode: 'NE1 1RQ', lat: 54.968816, lon: -1.610353, easting: 425044, northing: 563868 },
];

const TOLERANCE_METRES = 7;

function haversineMetres(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

test('osGridToWgs84 matches real ONS-surveyed coordinates to within a few metres, across the grid', () => {
  for (const g of GROUND_TRUTH) {
    const { lat, lon } = osGrid.osGridToWgs84(g.easting, g.northing);
    const errM = haversineMetres(lat, lon, g.lat, g.lon);
    assert.ok(errM < TOLERANCE_METRES, `${g.postcode}: ${errM.toFixed(2)}m off (expected <${TOLERANCE_METRES}m)`);
  }
});

test('wgs84ToOsGrid matches real ONS-surveyed coordinates to within a few metres, across the grid', () => {
  for (const g of GROUND_TRUTH) {
    const { easting, northing } = osGrid.wgs84ToOsGrid(g.lat, g.lon);
    const errM = Math.hypot(easting - g.easting, northing - g.northing);
    assert.ok(errM < TOLERANCE_METRES, `${g.postcode}: ${errM.toFixed(2)}m off (expected <${TOLERANCE_METRES}m)`);
  }
});

test('OS grid <-> WGS84 round-trips cleanly across the full grid extent, not just spot-checked squares', () => {
  // Deterministic PRNG (mulberry32) so failures reproduce instead of
  // flaking — this is checking the Redfearn formulae hold up everywhere,
  // not sampling for real-world plausibility (that's GROUND_TRUTH above).
  let seed = 20260720;
  function rand() {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  for (let i = 0; i < 500; i++) {
    // GB National Grid valid extent is roughly 0-700km easting, 0-1300km northing.
    const easting = rand() * 700000;
    const northing = rand() * 1300000;
    const { lat, lon } = osGrid.osGridToLatLon(easting, northing);
    const back = osGrid.latLonToOsGrid(lat, lon);
    // 2cm: comfortably above the Redfearn series' inherent truncation
    // residual at extreme/unrealistic corners of the declared 700x1300km
    // range (most of which is open sea, not actual GB) — a 25k-point sweep
    // across 5 seeds topped out around 1cm — while still well below
    // anything a real coding regression (sign flip, wrong constant, the
    // one-sided convergence-loop bug fixed alongside this test) would produce.
    assert.ok(Math.abs(back.easting - easting) < 0.02, `easting drift at (${easting}, ${northing}): ${back.easting}`);
    assert.ok(Math.abs(back.northing - northing) < 0.02, `northing drift at (${easting}, ${northing}): ${back.northing}`);
  }
});

test('Irish Grid projection definition matches the authoritative EPSG:29902/29903 parameters', () => {
  // Pinned against https://epsg.io/29902.proj4 (and 29903, identical) —
  // guards against a typo silently drifting from the published datum/
  // projection parameters, which a same-codebase round-trip test can't catch
  // since it would just as happily round-trip a wrong-but-self-consistent
  // definition.
  require('../src/irishGrid'); // registers the EPSG:29902 def as a side effect
  const proj4 = require('proj4');
  const def = proj4.defs('EPSG:29902');
  assert.equal(def.projName, 'tmerc');
  assert.ok(Math.abs(def.lat0 - (53.5 * Math.PI) / 180) < 1e-12);
  assert.ok(Math.abs(def.long0 - (-8 * Math.PI) / 180) < 1e-12);
  assert.equal(def.k0, 1.000035);
  assert.equal(def.x0, 200000);
  assert.equal(def.y0, 250000);
  assert.equal(def.ellps, 'mod_airy');
  assert.deepEqual(def.datum_params, [482.5, -130.6, 564.6, -1.042, -0.214, -0.631, 8.15]);
});

test('Irish Grid <-> WGS84 round-trips across Northern Ireland and the Republic', () => {
  const places = [
    { name: 'Belfast', lat: 54.597, lon: -5.93 },
    { name: 'Derry', lat: 54.9966, lon: -7.3086 },
    { name: 'Dublin', lat: 53.3498, lon: -6.2603 },
    { name: 'Cork', lat: 51.8985, lon: -8.4756 },
    { name: 'Galway', lat: 53.2707, lon: -9.0568 },
  ];
  for (const p of places) {
    const { easting, northing } = irishGrid.wgs84ToIrishGrid(p.lat, p.lon);
    const back = irishGrid.irishGridToWgs84(easting, northing);
    assert.ok(Math.abs(back.lat - p.lat) < 1e-6, `${p.name} lat drift: ${back.lat}`);
    assert.ok(Math.abs(back.lon - p.lon) < 1e-6, `${p.name} lon drift: ${back.lon}`);
  }
});
