# Postcode boundary polygons ("Regions" map mode)

## What's here

A GB postcode boundary dataset (`gb-postcodes-v5/`), broken into:

```
gb-postcodes-v5/
  areas/{AREA}.geojson                        e.g. areas/AB.geojson       — 1 feature
  districts/{DISTRICT}.geojson                e.g. districts/AB10.geojson — 1 feature
  sectors/{DISTRICT}/{DISTRICT} {N}.geojson    e.g. sectors/AB10/AB10 1.geojson — 1 feature
  units/{DISTRICT}.geojson                     e.g. units/AB10.geojson    — every unit
                                                postcode in that district as a
                                                separate feature (matched by
                                                a `mapit_code` property)
```

**These are not official Ordnance Survey / ONS boundaries** — they're a
decent approximation (most datasets like this are Voronoi/Thiessen
polygons generated from postcode centroids, not surveyed boundaries).
That's exactly why the map's "Regions" mode is labelled **experimental**
in the UI and every polygon popup says so — treat shapes as roughly
indicative, not authoritative, especially at the unit level where the
"boundary" is really just "closer to this postcode than any other."

It also only covers **Great Britain** — Northern Ireland postcodes
correctly return no boundary (the frontend falls back to the illustrative
circle for those), consistent with how the rest of the app already keeps
GB/NI handling separate.

## How it's loaded

`src/boundaries.js` does **not** eagerly load this dataset — the `units/`
folder alone is several gigabytes across thousands of files (one per GB
postcode district, each containing hundreds of individual unit-postcode
polygons). Instead, given a postcode and a requested level, it computes
the exact file path directly (the naming above is predictable) and reads
just that one file, on demand, with a small LRU-ish cache (last 300 files)
so repeat lookups in the same district/area don't re-hit disk.

Startup only checks that the dataset folder exists (logged to the
console); nothing is scanned or indexed upfront.

## Levels and fallback

`GET /api/boundary/:postcode?level=area|district|sector|unit` (default
`district`). If the exact level isn't available for that postcode — e.g.
you asked for `unit` but only have a partial/outward postcode like `SW1A`
with no specific unit known — it automatically falls back to the next
coarser level and reports what it actually returned in the `level` field
(vs. `requested`, what you asked for). The frontend surfaces this in the
map popup.

## Swapping in a different dataset

If you replace this with another dataset (e.g. real ONS Open Geography
Portal boundaries, `geoportal.statistics.gov.uk` — search "Postcode
Districts"/"Postcode Sectors", export as GeoJSON), it needs to follow the
same folder/filename convention above for the on-demand path lookup to
find it, and each feature needs a way to resolve its code — `mapit_code`
is tried first, then `area`/`district`/`sector`/`postcodes` as fallbacks
(see `normaliseMapitCode()` in `src/boundaries.js`). A single flat
GeoJSON-per-level file (rather than one-file-per-postcode) isn't currently
supported — you'd need to pre-split it into this layout, or extend
`src/boundaries.js`.
