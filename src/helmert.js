/**
 * Generic geodetic <-> cartesian conversion and 7-parameter Helmert
 * transform, used to move between the Airy 1830 (OSGB36) and WGS84
 * ellipsoids/datums.
 */

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

/** Geodetic (lat, lon, height) on a given ellipsoid -> geocentric cartesian XYZ. */
function geodeticToCartesian(lat, lon, h, ellipsoid) {
  const { a, b } = ellipsoid;
  const phi = lat * DEG2RAD;
  const lambda = lon * DEG2RAD;
  const e2 = 1 - (b * b) / (a * a);
  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const sinLambda = Math.sin(lambda);
  const cosLambda = Math.cos(lambda);
  const nu = a / Math.sqrt(1 - e2 * sinPhi * sinPhi);

  return {
    x: (nu + h) * cosPhi * cosLambda,
    y: (nu + h) * cosPhi * sinLambda,
    z: (nu * (1 - e2) + h) * sinPhi,
  };
}

/** Geocentric cartesian XYZ -> geodetic (lat, lon, height) on a given ellipsoid. */
function cartesianToGeodetic(x, y, z, ellipsoid) {
  const { a, b } = ellipsoid;
  const e2 = 1 - (b * b) / (a * a);
  const p = Math.sqrt(x * x + y * y);

  let phi = Math.atan2(z, p * (1 - e2));
  for (let i = 0; i < 10; i++) {
    const sinPhi = Math.sin(phi);
    const nu = a / Math.sqrt(1 - e2 * sinPhi * sinPhi);
    const phiNext = Math.atan2(z + e2 * nu * sinPhi, p);
    if (Math.abs(phiNext - phi) < 1e-14) {
      phi = phiNext;
      break;
    }
    phi = phiNext;
  }

  const sinPhi = Math.sin(phi);
  const nu = a / Math.sqrt(1 - e2 * sinPhi * sinPhi);
  const h = p / Math.cos(phi) - nu;
  const lambda = Math.atan2(y, x);

  return { lat: phi * RAD2DEG, lon: lambda * RAD2DEG, h };
}

/**
 * Apply a 7-parameter Helmert transform to a cartesian point.
 * t = { tx, ty, tz (metres), rx, ry, rz (arcseconds), s (ppm) }
 */
function helmertTransform({ x, y, z }, t) {
  const scale = 1 + t.s / 1e6;
  const rx = (t.rx / 3600) * DEG2RAD;
  const ry = (t.ry / 3600) * DEG2RAD;
  const rz = (t.rz / 3600) * DEG2RAD;

  return {
    x: t.tx + scale * (x - rz * y + ry * z),
    y: t.ty + scale * (rz * x + y - rx * z),
    z: t.tz + scale * (-ry * x + rx * y + z),
  };
}

/** Convert a lat/lon pair from one ellipsoid/datum to another via a Helmert transform. */
function transformDatum(lat, lon, fromEllipsoid, toEllipsoid, helmertParams) {
  const cartesian = geodeticToCartesian(lat, lon, 0, fromEllipsoid);
  const transformed = helmertTransform(cartesian, helmertParams);
  const geodetic = cartesianToGeodetic(transformed.x, transformed.y, transformed.z, toEllipsoid);
  return { lat: geodetic.lat, lon: geodetic.lon };
}

module.exports = { geodeticToCartesian, cartesianToGeodetic, helmertTransform, transformDatum };
