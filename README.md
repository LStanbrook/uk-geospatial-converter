# UK Geospatial Converter

Paste (or upload a CSV of) a mixed list of UK location references — OS Grid
Refs, Irish Grid Refs (Northern Ireland), Easting/Northing (OSGB36), Lat/Lon
(WGS84), or postcodes — and get every format back for each line, previewed
in a scrollable table + CSV box, plotted on a map, and exportable as CSV.

## CSV upload

Click **Upload CSV…** to load a file instead of pasting. It's parsed
client-side (handles quoted fields with embedded commas), shows a preview
of the first few rows, and lets you pick either **one column** (treated as
a single mixed location string per row, same as pasting) or **two columns**
(joined as `"A, B"` per row — for files with separate Latitude/Longitude or
Easting/Northing columns). There's a "first row is a header" toggle. Picked
columns get loaded into the input box for you to review before hitting
Convert — nothing is auto-converted on upload.

## Map display style

The map has a **Points / Regions** toggle (top-right), plus a region
**Size** selector (Area / District / Sector / Unit) that appears once
Regions is selected. "Points" is the default per-result marker. "Regions"
draws a postcode boundary polygon instead, at whatever size you pick — but
it's explicitly labelled **experimental** in the UI, because the shapes
come from an approximate, community-generated dataset rather than an
official OS/ONS boundary (see `data/postcode-boundaries/README.md`).
Non-postcode results (grid refs, E/N, lat/lon) always render as points,
since "region" isn't a meaningful concept for a raw coordinate. If no
boundary is found for a postcode (e.g. it's in Northern Ireland — this
dataset is GB-only), it falls back to a dashed circle, clearly marked as
illustrative rather than a real area.

## Architecture

```
┌─────────────────┐        POST /api/convert        ┌──────────────────────┐
│  Browser (SPA)   │ ───────────────────────────────▶ │   Express server      │
│  public/*.html/js │ ◀─────────────────────────────── │   server.js            │
│  Leaflet map      │        JSON results              │                        │
└─────────────────┘                                   │  src/convert.js        │
                                                        │   (orchestrator)        │
                                                        │        │                │
                                            ┌───────────┼────────┼────────────┐   │
                                            │           │        │            │   │
                                     src/detect.js  src/osGridRef.js   src/irishGrid.js
                                     (type sniffer)  (OSGB36 <-> WGS84) (Irish Grid <-> WGS84,
                                                       Redfearn TM +      via proj4 + EPSG:29902)
                                                       OS Helmert transform
                                                        │
                                                  src/postcode.js
                                                  ┌─────┴─────┐
                                             postcodes.io   data/ni-postcode-sample.json
                                             (GB, live API)  (NI, bundled sample — see below)
```

Everything runs server-side in plain Node.js (no build step). The frontend
is a static HTML/CSS/JS page (no framework) that POSTs pasted text to
`/api/convert` and renders the JSON response as a table + Leaflet map.

### Why this split

- **`src/osGridRef.js`** implements the OS's own published Redfearn
  Transverse Mercator formulae (from *"A guide to coordinate systems in
  Great Britain"*, Annex C) to go between OSGB36 lat/lon and British
  National Grid easting/northing, plus the standard published 7-parameter
  Helmert transform (Annex B) to move between OSGB36 (Airy 1830 ellipsoid)
  and WGS84. This is the same well-established ~metre-accuracy
  approximation used by most open-source GB coordinate libraries. **It is
  not OSTN15** — for cm-level survey-grade accuracy you'd need OS's official
  OSTN15 grid-shift file, which is out of scope here but is a drop-in
  replacement for the Helmert step if you need it later.

- **`src/irishGrid.js`** uses `proj4` with the EPSG:29902 (Irish Grid)
  definition, including its own `towgs84` Helmert parameters (different
  ellipsoid — modified Airy — and different projection origin from GB).
  This is the correct, distinct handling Northern Ireland needs; it is
  **not** just "OS Grid with different letters".

- **`src/detect.js`** classifies each pasted line. Some formats are
  genuinely ambiguous as bare strings (e.g. `TQ28` is syntactically both a
  valid 10km OS grid square *and* a valid partial postcode district). The
  detector's tie-breaking heuristic is documented in the file itself.

- **`src/postcode.js`** is deliberately split by jurisdiction because the
  *data* is split that way (see below).

- **`src/boundaries.js`** loads postcode boundary polygons on demand (see
  "Postcode boundary polygons" below) and exposes them via
  `GET /api/boundary/:code?level=...`.

## Postcode boundary polygons — experimental, approximate, GB only

`data/postcode-boundaries/gb-postcodes-v5/` holds a GB postcode boundary
dataset at all four levels (area/district/sector/unit). **It's not an
official OS/ONS boundary** — most datasets of this kind are
Voronoi/Thiessen polygons generated from postcode centroids, giving a
reasonable approximation rather than a surveyed shape — which is why
"Regions" mode is explicitly labelled experimental in the UI and every
polygon popup repeats that. It's also GB-only: Northern Ireland postcodes
correctly get no boundary and fall back to the illustrative circle,
consistent with the rest of the app keeping GB/NI handling separate.

The dataset is large (the `units/` folder alone is several gigabytes
across ~2,800 files), so `src/boundaries.js` never loads it eagerly —
given a postcode + requested level, it computes the exact file path
directly (the folder layout is predictable) and reads just that one file
on demand, with a small cache for repeat lookups. Requesting a level that
isn't available for a given postcode (e.g. `unit` for a partial/outward-
only postcode like `SW1A`) falls back to the next coarser level
automatically, and the API response tells you which one it actually
returned. Full details, including how to point this at a different/real
dataset later, are in `data/postcode-boundaries/README.md`.

## Northern Ireland — handled explicitly, not as an afterthought

Two distinct problems, both addressed:

1. **Coordinate system**: NI uses the Irish Grid (EPSG:29902), a different
   projection and ellipsoid from the rest of the UK's OSGB36/British
   National Grid. `src/irishGrid.js` handles this with its own projection
   math — a NI grid ref is never silently run through the GB grid formulas.

2. **Postcode data**: GB postcode-to-coordinate data (ONSPD / Code-Point
   Open) is freely redistributable and that's what `postcodes.io` (a free,
   no-key-required API built on that data) serves. Northern Ireland's
   unit-level postcode data is the **LPS "Pointer"** dataset, published
   separately by Land & Property Services via the NI Open Data portal
   (opendatani.gov.uk) — `postcodes.io` does not include it. So:
   - `src/postcode.js` detects `BT`-prefixed postcodes and routes them to a
     **separate NI provider** instead of silently 404ing against
     postcodes.io.
   - Shipped here is `data/ni-postcode-sample.json`, a small *sample* of
     approximate NI postcode **district** centroids, so the app works
     end-to-end out of the box without you having to source a licensed
     dataset first.
   - **For production**, download Pointer from opendatani.gov.uk and swap
     it in: replace `lookupNiPostcode()` in `src/postcode.js` with a loader
     over the real CSV/GeoJSON, keyed by full unit postcode instead of
     district. The rest of the pipeline (Irish Grid conversion, map
     rendering, CSV export) needs no changes — it already consumes whatever
     lat/lon the provider returns.

Every result also carries a `country` field (`Great Britain` /
`Northern Ireland`) derived from the postcode lookup or from a coarse
bounding-box check on the resolved coordinate, and the unified output
always has *both* a GB grid ref/easting/northing field pair *and* an Irish
grid ref/easting/northing field pair — populated independently depending on
where the point actually falls, so a GB grid reference for a Belfast point
is never fabricated (and vice versa).

## Running it

```bash
npm install
npm start        # http://localhost:3000
```

For local iteration with auto-restart: `npm run dev`.

## Testing

```bash
npm test
```

`test/convert.test.js` uses Node's built-in test runner (no extra
dependency) and checks:
- The OS grid formulae against Ordnance Survey's own published worked
  example (exact match).
- Round-trip consistency (grid → lat/lon → grid, and lat/lon → grid →
  lat/lon) for both OSGB36 and Irish Grid.
- A known real-world point (Edinburgh Castle, Belfast city centre) resolves
  to the right place.
- The type detector against one example of every supported format.
- `convertLine()` end-to-end for grid-ref inputs (no network required —
  postcode lookups need postcodes.io and aren't exercised in the offline
  test suite).

## API

`POST /api/convert` `{ "text": "NT 257 735\nSW1A 1AA\n..." }` → 
`{ "results": [ { input, type, error, lat, lon, osGridRef, easting,
northing, irishGridRef, eastingIrish, northingIrish, postcode, region,
country }, ... ] }`

One object per non-empty input line, in order. `type` is one of
`postcode_full`, `postcode_partial`, `os_grid`, `irish_grid`,
`easting_northing`, `latlon`, or `unknown`.

## Extending to bulk/offline GB lookups

`src/postcode.js` calls the public postcodes.io API, which is simplest for
getting started (no download, no key) but means postcode lookups need
network access and are rate-limited by the public API. For high-volume or
air-gapped use, there's a documented (unwired) stub in that file showing
how to load a local Code-Point Open CSV instead and go straight from
postcode → OSGB36 easting/northing without any network call.

## Known limitations

- OSGB36↔WGS84 and Irish Grid↔WGS84 use ~metre-accuracy Helmert
  approximations, not OSTN15/OSiNI's cm-accuracy grid-shift models.
- NI postcode data bundled here is a small sample at district (not unit)
  resolution — see "Northern Ireland" above for how to upgrade it.
- The 2-letter/2-digit grid-ref-vs-postcode ambiguity is resolved by a
  documented heuristic in `src/detect.js`, not a lookup of every real
  postcode area code — edge cases are possible for short, coarse (10km)
  grid references that happen to also be valid postcode districts.
- "Regions" map mode is approximate and GB-only — see "Postcode boundary
  polygons" above.
