/**
 * Loads postcode boundary polygons on demand from a dataset dropped in
 * data/postcode-boundaries/ (see the README there). Expects the layout
 * used by community-generated "gb-postcodes" style datasets, with either
 * plural or singular subfolder names:
 *
 *   <dataset root>/
 *     areas|area/{AREA}.geojson                       one feature, e.g. areas/AB.geojson
 *     districts|district/{DISTRICT}.geojson            one feature, e.g. districts/AB10.geojson
 *     sectors|sector/{DISTRICT}/{DISTRICT} {N}.geojson  one feature, e.g. sectors/AB10/AB10 1.geojson
 *     units|unit/{DISTRICT}.geojson                     MANY features (every unit postcode in that
 *                                                        district), matched by a mapit_code/postcode property
 *
 * If more than one candidate dataset folder is found one level down inside
 * data/postcode-boundaries/, the most recently modified one wins — so
 * dropping in a replacement dataset alongside an old one is enough to
 * switch over, no code change needed. Set POSTCODE_BOUNDARIES_DATASET to a
 * folder name (e.g. "gb-postcodes-v5") to pin a specific one instead.
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
// Datasets are laid out with either plural ("areas/") or singular ("area/")
// subfolder names depending on the source generator — both are accepted.
const SUBDIR_CONVENTIONS = [
  { area: 'areas', district: 'districts', sector: 'sectors', unit: 'units' },
  { area: 'area', district: 'district', sector: 'sector', unit: 'unit' },
];
const LEVELS = ['area', 'district', 'sector', 'unit'];
const MAX_CACHED_FILES = 300;

let dataset; // resolved once, then cached; `null` means "checked, not found"
const fileCache = new Map(); // filePath -> parsed JSON (or null)

/** Returns the matching subdir-name convention for `dir`, or null if incomplete. */
function matchSubdirConvention(dir) {
  return (
    SUBDIR_CONVENTIONS.find((subdirs) =>
      Object.values(subdirs).every((sub) => {
        try {
          return fs.statSync(path.join(dir, sub)).isDirectory();
        } catch {
          return false;
        }
      })
    ) || null
  );
}

/**
 * Finds the dataset root: either data/postcode-boundaries/ itself, or one
 * subfolder down. When multiple candidate dataset folders exist one level
 * down (e.g. swapping in a replacement without deleting the old one), the
 * most recently modified one wins.
 */
function resolveDatasetRoot() {
  if (dataset !== undefined) return dataset;

  const pinned = process.env.POSTCODE_BOUNDARIES_DATASET;
  if (pinned) {
    const candidate = path.join(BOUNDARIES_DIR, pinned);
    const subdirs = matchSubdirConvention(candidate);
    if (subdirs) {
      dataset = { root: candidate, subdirs };
      return dataset;
    }
    console.warn(`[boundaries] POSTCODE_BOUNDARIES_DATASET="${pinned}" not found or incomplete — falling back to auto-detect.`);
  }

  const atTopLevel = matchSubdirConvention(BOUNDARIES_DIR);
  if (atTopLevel) {
    dataset = { root: BOUNDARIES_DIR, subdirs: atTopLevel };
    return dataset;
  }

  try {
    const entries = fs.readdirSync(BOUNDARIES_DIR, { withFileTypes: true });
    let best = null;
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const candidate = path.join(BOUNDARIES_DIR, entry.name);
      const subdirs = matchSubdirConvention(candidate);
      if (!subdirs) continue;
      const mtimeMs = fs.statSync(candidate).mtimeMs;
      if (!best || mtimeMs > best.mtimeMs) best = { root: candidate, subdirs, mtimeMs };
    }
    dataset = best ? { root: best.root, subdirs: best.subdirs } : null;
    return dataset;
  } catch {
    // BOUNDARIES_DIR itself doesn't exist — fine, no dataset available.
  }

  dataset = null;
  return dataset;
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

function filePathForLevel(root, subdirs, level, parts) {
  switch (level) {
    case 'area':
      return parts.area ? path.join(root, subdirs.area, `${parts.area}.geojson`) : null;
    case 'district':
      return parts.district ? path.join(root, subdirs.district, `${parts.district}.geojson`) : null;
    case 'sector':
      return parts.sectorFileName
        ? path.join(root, subdirs.sector, parts.district, `${parts.sectorFileName}.geojson`)
        : null;
    case 'unit':
      return parts.district ? path.join(root, subdirs.unit, `${parts.district}.geojson`) : null;
    default:
      return null;
  }
}

function normaliseMapitCode(props) {
  const raw =
    props?.mapit_code ?? props?.area ?? props?.district ?? props?.sector ?? props?.postcodes ?? props?.postcode;
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
  const ds = resolveDatasetRoot();
  if (!ds) return null;

  const parts = postcodeParts(postcode);
  if (!parts) return null;

  for (const level of fallbackChain(requestedLevel)) {
    const filePath = filePathForLevel(ds.root, ds.subdirs, level, parts);
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

// ---------------------------------------------------------------------
// Reverse spatial lookup: which district contains an arbitrary point?
// ---------------------------------------------------------------------
//
// findBoundary() above only answers "what does this postcode's boundary
// look like" — it needs a postcode to start from. Reverse-geocoding a grid
// ref/lat-lon to a postcode (see src/postcode.js) instead asks "which
// postcode is near this point", via postcodes.io's nearest-*address*
// search — which can come back empty for points genuinely far from any
// addressed postcode (rural moorland, etc.), even though this boundary
// dataset, being a gapless Voronoi/Thiessen tessellation, always has some
// district that geographically contains the point. findDistrictForPoint()
// answers that different question — point-in-polygon against the
// boundary polygons themselves, no nearby address required.

/** Ray-casting point-in-ring test. `point` and `ring` are [lon, lat] pairs. */
function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** A point is inside a polygon (rings: [outer, ...holes]) iff inside the outer ring and no hole. */
function pointInPolygonRings(lon, lat, rings) {
  if (!rings.length || !pointInRing(lon, lat, rings[0])) return false;
  for (let i = 1; i < rings.length; i++) {
    if (pointInRing(lon, lat, rings[i])) return false;
  }
  return true;
}

/** Handles both GeoJSON Polygon and MultiPolygon geometries. */
function pointInGeometry(lon, lat, geometry) {
  if (!geometry) return false;
  if (geometry.type === 'Polygon') return pointInPolygonRings(lon, lat, geometry.coordinates);
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.some((rings) => pointInPolygonRings(lon, lat, rings));
  }
  return false;
}

/** Finds the code (from feature properties) of whichever polygon in `dir` contains the point, or null. */
function findContainingFeatureCode(dir, lat, lon) {
  let filenames;
  try {
    filenames = fs.readdirSync(dir).filter((f) => f.endsWith('.geojson'));
  } catch {
    return null;
  }

  for (const filename of filenames) {
    const data = loadFile(path.join(dir, filename));
    if (!data || !Array.isArray(data.features)) continue;
    for (const feature of data.features) {
      if (pointInGeometry(lon, lat, feature.geometry)) {
        return normaliseMapitCode(feature.properties) || filename.replace(/\.geojson$/i, '');
      }
    }
  }
  return null;
}

/**
 * Spatially resolves a lat/lon to the postcode district (e.g. "TA1") whose
 * boundary polygon contains it, even where no address-based postcode
 * search finds anything nearby. Falls back to just the area (e.g. "TA")
 * if no single district file matches. Returns null only if there's no
 * dataset at all, or the point genuinely falls outside its coverage (e.g.
 * off the coast, or Northern Ireland, which this GB-only dataset excludes).
 */
function findDistrictForPoint(lat, lon) {
  const ds = resolveDatasetRoot();
  if (!ds) return null;

  const areaCode = findContainingFeatureCode(path.join(ds.root, ds.subdirs.area), lat, lon);
  if (!areaCode) return null;

  let districtFilenames;
  try {
    districtFilenames = fs
      .readdirSync(path.join(ds.root, ds.subdirs.district))
      .filter((f) => new RegExp(`^${areaCode}\\d+\\.geojson$`, 'i').test(f));
  } catch {
    districtFilenames = [];
  }

  for (const filename of districtFilenames) {
    const data = loadFile(path.join(ds.root, ds.subdirs.district, filename));
    if (!data || !Array.isArray(data.features)) continue;
    for (const feature of data.features) {
      if (pointInGeometry(lon, lat, feature.geometry)) {
        return normaliseMapitCode(feature.properties) || filename.replace(/\.geojson$/i, '');
      }
    }
  }

  return areaCode; // point is in this area, but not clearly inside any one district's polygon
}

/** Called once at server startup, purely to log whether a dataset was found. */
function loadBoundaries() {
  const ds = resolveDatasetRoot();
  if (!ds) {
    console.log('[boundaries] No dataset found in data/postcode-boundaries/ — using circle fallback only.');
  } else {
    console.log(`[boundaries] Found postcode boundary dataset at ${ds.root} (loaded on demand, not eagerly).`);
  }
}

module.exports = { loadBoundaries, findBoundary, findDistrictForPoint };
