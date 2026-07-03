/**
 * Orchestrates detection + conversion for a single pasted line into the
 * unified output shape the frontend/CSV export expects.
 */

const { detectType, TYPES } = require('./detect');
const osGrid = require('./osGridRef');
const irishGrid = require('./irishGrid');
const { lookupPostcode, nearestGbPostcode } = require('./postcode');

// Loose bounding boxes used only to decide which "native" grid conversions
// are meaningful to show, not for strict validation.
const GB_BBOX = { minLat: 49.8, maxLat: 61.1, minLon: -8.8, maxLon: 1.9 };
const IE_BBOX = { minLat: 51.3, maxLat: 55.5, minLon: -10.8, maxLon: -5.3 };

function within(bbox, lat, lon) {
  return lat >= bbox.minLat && lat <= bbox.maxLat && lon >= bbox.minLon && lon <= bbox.maxLon;
}

function blankResult(input) {
  return {
    input,
    type: null,
    error: null,
    lat: null,
    lon: null,
    osGridRef: null,
    easting: null,
    northing: null,
    irishGridRef: null,
    eastingIrish: null,
    northingIrish: null,
    postcode: null,
    region: null,
    country: null,
  };
}

/**
 * Fill in GB grid ref + Irish grid ref fields from a resolved WGS84 lat/lon.
 *
 * GB_BBOX and IE_BBOX are simple rectangles and genuinely overlap (Northern
 * Ireland sits within the same latitude band as western Scotland/Wales) —
 * a rectangle alone can't cleanly separate the two nations. The British
 * National Grid was never surveyed over Northern Ireland, so showing a
 * mathematically-extrapolated OS Grid Ref for e.g. a Belfast point would be
 * misleading. We break the tie by giving Ireland priority: a point inside
 * IE_BBOX is treated as Irish Grid only, never both. The one accepted
 * trade-off is that a genuinely GB point that also falls inside IE_BBOX
 * (parts of the Isle of Man / western Scottish isles) won't get a GB grid
 * ref either — rarer, and less misleading than the alternative.
 */
function populateDerivedGrids(result) {
  const { lat, lon } = result;
  if (lat == null || lon == null) return;

  const inIreland = within(IE_BBOX, lat, lon);

  if (inIreland) {
    const { easting, northing } = irishGrid.wgs84ToIrishGrid(lat, lon);
    result.eastingIrish = Math.round(easting);
    result.northingIrish = Math.round(northing);
    result.irishGridRef = irishGrid.formatIrishGridRef(easting, northing);
    return;
  }

  if (within(GB_BBOX, lat, lon)) {
    const { easting, northing } = osGrid.wgs84ToOsGrid(lat, lon);
    result.easting = Math.round(easting);
    result.northing = Math.round(northing);
    result.osGridRef = osGrid.formatGridRef(easting, northing);
  }
}

async function convertLine(raw) {
  const result = blankResult(raw);
  const type = detectType(raw);
  result.type = type;

  if (!type || type === TYPES.UNKNOWN) {
    result.error = 'Could not detect input type';
    return result;
  }

  try {
    switch (type) {
      case TYPES.LATLON: {
        const [latStr, lonStr] = raw.trim().split(/\s*[, ]\s*/);
        result.lat = parseFloat(latStr);
        result.lon = parseFloat(lonStr);
        populateDerivedGrids(result);
        break;
      }

      case TYPES.EASTING_NORTHING: {
        const [eStr, nStr] = raw.trim().split(/\s*[, ]\s*/);
        const easting = parseFloat(eStr);
        const northing = parseFloat(nStr);
        result.easting = easting;
        result.northing = northing;
        result.osGridRef = osGrid.formatGridRef(easting, northing);
        const wgs84 = osGrid.osGridToWgs84(easting, northing);
        result.lat = wgs84.lat;
        result.lon = wgs84.lon;
        // Also populate Irish grid if the resolved point happens to fall in Ireland.
        if (within(IE_BBOX, result.lat, result.lon)) {
          const ig = irishGrid.wgs84ToIrishGrid(result.lat, result.lon);
          result.eastingIrish = Math.round(ig.easting);
          result.northingIrish = Math.round(ig.northing);
          result.irishGridRef = irishGrid.formatIrishGridRef(ig.easting, ig.northing);
        }
        break;
      }

      case TYPES.OS_GRID: {
        const parsed = osGrid.parseGridRef(raw);
        if (!parsed) {
          result.error = 'Could not parse OS Grid Reference';
          break;
        }
        result.easting = parsed.easting;
        result.northing = parsed.northing;
        result.osGridRef = osGrid.formatGridRef(parsed.easting, parsed.northing);
        const wgs84 = osGrid.osGridToWgs84(parsed.easting, parsed.northing);
        result.lat = wgs84.lat;
        result.lon = wgs84.lon;
        break;
      }

      case TYPES.IRISH_GRID: {
        const parsed = irishGrid.parseIrishGridRef(raw);
        if (!parsed) {
          result.error = 'Could not parse Irish Grid Reference';
          break;
        }
        result.eastingIrish = parsed.easting;
        result.northingIrish = parsed.northing;
        result.irishGridRef = irishGrid.formatIrishGridRef(parsed.easting, parsed.northing);
        const wgs84 = irishGrid.irishGridToWgs84(parsed.easting, parsed.northing);
        result.lat = wgs84.lat;
        result.lon = wgs84.lon;
        result.country = 'Northern Ireland';
        break;
      }

      case TYPES.POSTCODE_FULL:
      case TYPES.POSTCODE_PARTIAL: {
        const looked = await lookupPostcode(raw);
        if (!looked) {
          result.error = 'Postcode not found';
          break;
        }
        result.lat = looked.lat;
        result.lon = looked.lon;
        result.postcode = looked.postcode;
        result.region = looked.region;
        result.country = looked.country;
        populateDerivedGrids(result);
        break;
      }

      default:
        result.error = 'Unsupported input type';
    }
  } catch (err) {
    result.error = err.message || 'Conversion failed';
  }

  // Best-effort reverse geocode a postcode/region for grid/coordinate inputs
  // that resolved to a GB point but didn't come from a postcode already.
  if (!result.postcode && !result.error && result.lat != null && within(GB_BBOX, result.lat, result.lon)) {
    const nearest = await nearestGbPostcode(result.lat, result.lon);
    if (nearest) {
      result.postcode = `~${nearest.postcode}`; // '~' marks this as approximate/reverse-geocoded
      result.region = result.region || nearest.region;
    }
  }

  if (!result.country && result.lat != null) {
    if (within(IE_BBOX, result.lat, result.lon)) result.country = 'Northern Ireland / Ireland';
    else if (within(GB_BBOX, result.lat, result.lon)) result.country = 'Great Britain';
  }

  return result;
}

async function convertBatch(lines) {
  return Promise.all(lines.map((line) => convertLine(line)));
}

module.exports = { convertLine, convertBatch };
