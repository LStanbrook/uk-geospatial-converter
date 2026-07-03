/**
 * Reference ellipsoids and datum transform parameters used across the app.
 *
 * OSGB36<->WGS84 uses the standard Ordnance Survey 7-parameter Helmert
 * approximation (published in "A guide to coordinate systems in Great
 * Britain", Annex B). It is accurate to a few metres — good enough for
 * general-purpose conversion, address matching, and mapping. For survey
 * grade (cm-level) accuracy OS's OSTN15 grid-shift model is required
 * instead; that is out of scope here but is called out in the README.
 */

const ELLIPSOIDS = {
  AIRY_1830: { a: 6377563.396, b: 6356256.909 },
  WGS84: { a: 6378137.0, b: 6356752.314245 },
};

// WGS84 -> OSGB36 (Helmert 7-parameter transform: translation in metres,
// rotation in arcseconds, scale in ppm), as published by Ordnance Survey.
const WGS84_TO_OSGB36 = {
  tx: -446.448,
  ty: 125.157,
  tz: -542.06,
  rx: -0.1502,
  ry: -0.247,
  rz: -0.8421,
  s: 20.4894,
};

// OSGB36 -> WGS84 is the inverse transform. For small rotations/scale this
// is well approximated by negating every parameter (the same convention
// used by OS's published guidance and by widely used open implementations).
const OSGB36_TO_WGS84 = {
  tx: -WGS84_TO_OSGB36.tx,
  ty: -WGS84_TO_OSGB36.ty,
  tz: -WGS84_TO_OSGB36.tz,
  rx: -WGS84_TO_OSGB36.rx,
  ry: -WGS84_TO_OSGB36.ry,
  rz: -WGS84_TO_OSGB36.rz,
  s: -WGS84_TO_OSGB36.s,
};

module.exports = { ELLIPSOIDS, WGS84_TO_OSGB36, OSGB36_TO_WGS84 };
