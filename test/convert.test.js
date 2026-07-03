const test = require('node:test');
const assert = require('node:assert/strict');

const osGrid = require('../src/osGridRef');
const irishGrid = require('../src/irishGrid');
const { detectType, TYPES } = require('../src/detect');

// Known reference point: Ordnance Survey's own worked example in
// "A guide to coordinate systems in Great Britain" — OSGB36 grid
// TG 51409 13177 <-> OSGB36 lat/lon 52.65757, 1.71792 (approx).
test('OS grid <-> OSGB36 lat/lon round-trips and matches the OS worked example', () => {
  const easting = 651409.903;
  const northing = 313177.27;
  const { lat, lon } = osGrid.osGridToLatLon(easting, northing);
  assert.ok(Math.abs(lat - 52.6575) < 0.001, `lat was ${lat}`);
  assert.ok(Math.abs(lon - 1.7179) < 0.001, `lon was ${lon}`);

  const back = osGrid.latLonToOsGrid(lat, lon);
  assert.ok(Math.abs(back.easting - easting) < 0.01);
  assert.ok(Math.abs(back.northing - northing) < 0.01);
});

test('OS grid reference parsing and round-trip formatting', () => {
  const a = osGrid.parseGridRef('NT 257 735');
  const b = osGrid.parseGridRef('NT257735');
  assert.deepEqual(a, b);
  assert.equal(a.easting, 325700);
  assert.equal(a.northing, 673500);

  const formatted = osGrid.formatGridRef(325700, 673500);
  assert.equal(formatted, 'NT 257 735');
});

test('OS grid ref -> WGS84 -> back is consistent for a known city (Edinburgh Castle, NT 253 735)', () => {
  const parsed = osGrid.parseGridRef('NT 253 735');
  const wgs84 = osGrid.osGridToWgs84(parsed.easting, parsed.northing);
  // Edinburgh Castle is approx 55.9486 N, -3.1999 W in WGS84.
  assert.ok(Math.abs(wgs84.lat - 55.9486) < 0.01, `lat was ${wgs84.lat}`);
  assert.ok(Math.abs(wgs84.lon - -3.1999) < 0.01, `lon was ${wgs84.lon}`);

  const back = osGrid.wgs84ToOsGrid(wgs84.lat, wgs84.lon);
  assert.ok(Math.abs(back.easting - parsed.easting) < 1);
  assert.ok(Math.abs(back.northing - parsed.northing) < 1);
});

test('Irish grid reference parsing round-trips (Belfast, J 337 749)', () => {
  const parsed = irishGrid.parseIrishGridRef('J 337 749');
  assert.equal(parsed.easting, 333700);
  assert.equal(parsed.northing, 374900);

  const formatted = irishGrid.formatIrishGridRef(333700, 374900);
  assert.equal(formatted, 'J 337 749');
});

test('Irish grid -> WGS84 lands near Belfast', () => {
  const parsed = irishGrid.parseIrishGridRef('J 337 749');
  const wgs84 = irishGrid.irishGridToWgs84(parsed.easting, parsed.northing);
  // Belfast city centre is approx 54.597 N, -5.930 W.
  assert.ok(Math.abs(wgs84.lat - 54.597) < 0.05, `lat was ${wgs84.lat}`);
  assert.ok(Math.abs(wgs84.lon - -5.93) < 0.05, `lon was ${wgs84.lon}`);
});

test('Irish grid round-trip WGS84 -> Irish grid -> WGS84 is consistent', () => {
  const lat = 54.597;
  const lon = -5.93;
  const { easting, northing } = irishGrid.wgs84ToIrishGrid(lat, lon);
  const back = irishGrid.irishGridToWgs84(easting, northing);
  assert.ok(Math.abs(back.lat - lat) < 0.0001);
  assert.ok(Math.abs(back.lon - lon) < 0.0001);
});

test('detectType classifies each supported input format', () => {
  assert.equal(detectType('SW1A 1AA'), TYPES.POSTCODE_FULL);
  assert.equal(detectType('sw1a1aa'), TYPES.POSTCODE_FULL);
  assert.equal(detectType('BT1 5GS'), TYPES.POSTCODE_FULL);
  assert.equal(detectType('SW1A'), TYPES.POSTCODE_PARTIAL);
  assert.equal(detectType('M1'), TYPES.POSTCODE_PARTIAL);
  assert.equal(detectType('NT 257 735'), TYPES.OS_GRID);
  assert.equal(detectType('TQ2880'), TYPES.OS_GRID);
  assert.equal(detectType('J 335 745'), TYPES.IRISH_GRID);
  assert.equal(detectType('437295, 115541'), TYPES.EASTING_NORTHING);
  assert.equal(detectType('51.5074, -0.1278'), TYPES.LATLON);
  assert.equal(detectType(''), null);
});

test('convertLine end-to-end for an OS grid reference (no network required)', async () => {
  const { convertLine } = require('../src/convert');
  const result = await convertLine('NT 253 735');
  assert.equal(result.type, TYPES.OS_GRID);
  assert.equal(result.error, null);
  assert.ok(Math.abs(result.lat - 55.9486) < 0.01);
  assert.ok(Math.abs(result.lon - -3.1999) < 0.01);
  assert.equal(result.osGridRef, 'NT 253 735');
});

test('convertLine end-to-end for an Irish grid reference (no network required)', async () => {
  const { convertLine } = require('../src/convert');
  const result = await convertLine('J 337 749');
  assert.equal(result.type, TYPES.IRISH_GRID);
  assert.equal(result.error, null);
  assert.ok(Math.abs(result.lat - 54.597) < 0.05);
  assert.equal(result.country, 'Northern Ireland');
});

test('convertLine flags unparseable input', async () => {
  const { convertLine } = require('../src/convert');
  const result = await convertLine('not a real location@@@');
  assert.equal(result.error, 'Could not detect input type');
});
