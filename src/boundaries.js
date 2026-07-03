/**
 * Loads postcode boundary polygons on demand from a dataset dropped in
 * data/postcode-boundaries/ (see the README there). Expects the layout
 * used by community-generated "gb-postcodes" style datasets:
 *
 *   <dataset root>/
 *     areas/{AREA}.geojson                       one feature, e.g. areas/AB.geojson
 *     districts/{DISTRICT}.geojson                one feature, e.g. districts/AB10.geojson
 *     sectors/{DISTRICT}/{DISTRICT} {N}.geojson    one feature, e.g. sectors/AB10/AB10 1.geojson
 *     units/{DISTRICT}.geojson                     MANY features (every unit postcode in that
 *                                                   district), matched by a mapit_code property
 *
 * This is an *approximation* — typically Voronoi/Thiessen polygons built
 * from postcode centroids, not an official Ordnance Survey / ONS boundary
 * — which is exactly why the frontend always labels "Regions" mode as
 * experimental and shows what level of boundary was actually returned.
 *
 * Files are read lazily and cached by path (with a size cap), never
 * eagerly indexed — a full unit-level dataset is multiple gigabytes across
 * tens of thousands of files, so scanning/loading it all at startup isn't
 * viable.
 */

const fs = require('fs');
const path = require('path');

const BOUNDARIES_DIR = path.join(__dirname, '..', 'data', 'postcode-boundaries');
const REQUIRED_SUBDIRS = ['areas', 'districts', 'sectors', 'units'];
const LEVELS = ['area', 'district', 'sector', 'unit'];
const MAX_CACHED_FILES = 300;

let datasetRoot; // resolved once, then cached; `null` means "checked, not found"
const fileCache = new Map(); // filePath -> parsed JSON (or null)

function hasAllSubdirs(dir) {
  return REQUIRED_SUBDIRS.every((sub) => {
    try {
      return fs.statSync(path.join(dir, sub)).isDirectory();
    } catch {
      return false;
    }
  });
}

/** Finds the dataset root: either data/postcode-boundaries/ itself, or one subfolder down. */
function resolveDatasetRoot() {
  if (datasetRoot !== undefined) return datasetRoot;

  if (hasAllSubdirs(BOUNDARIES_DIR)) {
    datasetRoot = BOUNDARIES_DIR;
    return datasetRoot;
  }

  try {
    const entries = fs.readdirSync(BOUNDARIES_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const candidate = path.join(BOUNDARIES_DIR, entry.name);
      if (hasAllSubdirs(candidate)) {
        datasetRoot = candidate;
        return datasetRoot;
      }
    }
  } catch {
    // BOUNDARIES_DIR itself doesn't exist — fine, no dataset available.
  }

  datasetRoot = null;
  return datasetRoot;
}

function loadFile(filePath) {
  if (fileCache.has(filePath)) {
    const cached = fileCache.get(filePath);
    // Re-insert to mark as most-recently-used.
    fileCache.delete(filePath);
    fileCache.set(filePath, cached);
    return cached;
  }

  let data = null;
  try {
    if (fs.existsSync(filePath)) {
      data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch (err) {
    console.warn(`[boundaries] Failed to parse ${filePath}: ${err.message}`);
  }

  if (fileCache.size >= MAX_CACHED_FILES) {
    const oldest = fileCache.keys().next().value;
    fileCache.delete(oldest);
  }
  fileCache.set(filePath, data);
  return data;
}

/** Breaks a postcode down into the area/district/sector/unit codes this dataset keys on. */
function postcodeParts(rawPostcode) {
  const compact = String(rawPostcode || '')
    .replace(/^~/, '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
  if (!compact) return null;

  const isFull = /^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/.test(compact);
  const outward = isFull ? compact.slice(0, -3) : compact;
  const inward = isFull ? compact.slice(-3) : null;
  const area = outward.match(/^[A-Z]{1,2}/)?.[0] || null;
  const district = outward || null;
  const sectorDigit = inward ? inward[0] : null;

  return {
    area,
    district,
    unit: inward ? `${district}${inward}` : null, // e.g. AB101AB — matches mapit_code
    sectorFileName: sectorDigit ? `${district} ${sectorDigit}` : null, // e.g. "AB10 1" — matches the filename
  };
}

function filePathForLevel(root, level, parts) {
  switch (level) {
    case 'area':
      return parts.area ? path.join(root, 'areas', `${parts.area}.geojson`) : null;
    case 'district':
      return parts.district ? path.join(root, 'districts', `${parts.district}.geojson`) : null;
    case 'sector':
      return parts.sectorFileName
        ? path.join(root, 'sectors', parts.district, `${parts.sectorFileName}.geojson`)
        : null;
    case 'unit':
      return parts.district ? path.join(root, 'units', `${parts.district}.geojson`) : null;
    default:
      return null;
  }
}

function normaliseMapitCode(props) {
  const raw = props?.mapit_code ?? props?.area ?? props?.district ?? props?.sector ?? props?.postcodes;
  return raw ? String(raw).toUpperCase().replace(/\s+/g, '') : null;
}

/** Fallback chain: e.g. requesting 'unit' tries unit, then sector, then district, then area. */
function fallbackChain(requestedLevel) {
  const i = LEVELS.indexOf(requestedLevel);
  return i === -1 ? LEVELS : LEVELS.slice(0, i + 1).reverse();
}

/**
 * Look up a boundary polygon for a postcode at (up to) the requested level.
 * Falls back to coarser levels if the exact one isn't available — e.g. a
 * partial postcode (district only) requested at 'unit' level will fall
 * back to 'district'. Returns { geometry, level, code } or null.
 */
function findBoundary(postcode, requestedLevel = 'district') {
  const root = resolveDatasetRoot();
  if (!root) return null;

  const parts = postcodeParts(postcode);
  if (!parts) return null;

  for (const level of fallbackChain(requestedLevel)) {
    const filePath = filePathForLevel(root, level, parts);
    if (!filePath) continue;

    const data = loadFile(filePath);
    if (!data || !Array.isArray(data.features) || data.features.length === 0) continue;

    if (level === 'unit') {
      const feature = data.features.find((f) => normaliseMapitCode(f.properties) === parts.unit);
      if (feature) return { geometry: feature.geometry, level, code: parts.unit };
    } else {
      const feature = data.features[0];
      if (feature) return { geometry: feature.geometry, level, code: normaliseMapitCode(feature.properties) };
    }
  }

  return null;
}

/** Called once at server startup, purely to log whether a dataset was found. */
function loadBoundaries() {
  const root = resolveDatasetRoot();
  if (!root) {
    console.log('[boundaries] No dataset found in data/postcode-boundaries/ — using circle fallback only.');
  } else {
    console.log(`[boundaries] Found postcode boundary dataset at ${root} (loaded on demand, not eagerly).`);
  }
}

module.exports = { loadBoundaries, findBoundary };
