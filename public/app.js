const TYPE_COLOURS = {
  postcode_full: '#2563eb',
  postcode_partial: '#60a5fa',
  os_grid: '#16a34a',
  irish_grid: '#f59e0b',
  easting_northing: '#7c3aed',
  latlon: '#dc2626',
  unknown: '#6b7280',
};

const TYPE_LABELS = {
  postcode_full: 'Postcode (full)',
  postcode_partial: 'Postcode (partial)',
  os_grid: 'OS Grid Ref',
  irish_grid: 'Irish Grid Ref',
  easting_northing: 'Easting/Northing',
  latlon: 'Lat/Lon',
  unknown: 'Unknown',
};

// Illustrative-only radii (metres) used when no real boundary polygon is
// available for a postcode (e.g. Northern Ireland, not covered by the
// bundled GB dataset — see data/postcode-boundaries/README.md). Scaled by
// the selected region size so "Area" reads visibly bigger than "Unit",
// even though these are rough stand-ins, not measured to any real extent.
const AREA_RADIUS_METRES = { area: 15000, district: 4000, sector: 1200, unit: 150 };

let map;
let markerLayer;
let lastResults = [];
let displayStyle = 'points'; // 'points' | 'area'

function initMap() {
  // Leaflet defaults to SVG for vector layers (points, circles, region
  // polygons) — one DOM element per shape, which gets very expensive with
  // hundreds/thousands of them (a full 2000-line batch in Regions mode).
  // Canvas rendering draws them as pixels on a single element instead,
  // which is dramatically cheaper at that scale — this is the standard
  // fix for "the map chokes on lots of shapes", not fetch concurrency.
  map = L.map('map', {
    renderer: L.canvas(),
    // Scroll-wheel zoom defaults to jumping a whole zoom level at a time.
    // zoomSnap lets it rest at quarter-levels instead of only integers, and
    // wheelPxPerZoomLevel (default 60) requires more scroll distance per
    // level, so each scroll tick moves the map a smaller, more gradual amount.
    zoomSnap: 0.25,
    zoomDelta: 0.25,
    wheelPxPerZoomLevel: 120,
  }).setView([54.5, -3.5], 6);
  // CartoDB's basemap tiles, not raw tile.openstreetmap.org: the latter's
  // usage policy throttles/blocks normal interactive (non-cached) use,
  // which shows up as tiles greying out and never loading while panning —
  // exactly the symptom this was swapped in to fix. Data is still OSM,
  // just served through a provider that tolerates this kind of use.
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 19,
  }).addTo(map);
  markerLayer = L.layerGroup().addTo(map);
  renderLegend();

  // Leaflet caches the container's pixel size at init/last-known-good time;
  // if the CSS grid/flex layout around #map settles or changes afterwards
  // (webfonts loading, panel content changing height, etc.) without
  // Leaflet being told, its internal viewport tracking goes stale — the
  // classic cause of grey/unloaded tiles and markers appearing to vanish
  // when panning. A ResizeObserver keeps it in sync automatically.
  const mapEl = document.getElementById('map');
  if (window.ResizeObserver) {
    new ResizeObserver(() => map.invalidateSize()).observe(mapEl);
  }
  window.addEventListener('resize', () => map.invalidateSize());
  setTimeout(() => map.invalidateSize(), 300);
}

function renderLegend() {
  const el = document.getElementById('legend');
  el.innerHTML = Object.entries(TYPE_LABELS)
    .map(([key, label]) => `<div><span class="swatch" style="background:${TYPE_COLOURS[key]}"></span>${label}</div>`)
    .join('');
}

// NOT_FOUND marks a field that we tried and failed to resolve, as opposed
// to a field that's simply not applicable (e.g. no Irish Grid ref for a
// point in London — that's a legitimate blank, not a failure).
const NOT_FOUND = 'NOT FOUND';

function fmt(v, digits) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number' && digits != null) return v.toFixed(digits);
  return String(v);
}

/** Like fmt(), but renders NOT_FOUND for missing fields on rows that errored. */
function fmtField(v, hasError, digits) {
  if (v === null || v === undefined) return hasError ? NOT_FOUND : '';
  if (typeof v === 'number' && digits != null) return v.toFixed(digits);
  return String(v);
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------------------------------------------------------------------
// Results table
// ---------------------------------------------------------------------

function renderTable(results) {
  const rowCount = document.getElementById('results-row-count');
  const errorCount = results.filter((r) => r.error).length;
  rowCount.textContent = `${results.length} row(s)${errorCount ? `, ${errorCount} NOT FOUND` : ''}`;

  const tbody = document.getElementById('results-body');
  tbody.innerHTML = results
    .map((r) => {
      const hasError = Boolean(r.error);
      const rowClass = hasError ? 'error-row' : '';
      const colour = TYPE_COLOURS[r.type] || TYPE_COLOURS.unknown;
      const label = TYPE_LABELS[r.type] || r.type || 'Unknown';
      const cell = (v, digits) => {
        const text = fmtField(v, hasError, digits);
        return text === NOT_FOUND ? `<span class="not-found">${NOT_FOUND}</span>` : escapeHtml(text);
      };
      return `<tr class="${rowClass}">
        <td>${escapeHtml(r.input)}</td>
        <td><span class="type-badge" style="background:${colour}">${label}</span>${r.error ? ` — ${escapeHtml(r.error)}` : ''}</td>
        <td>${cell(r.osGridRef)}</td>
        <td>${cell(r.easting)}</td>
        <td>${cell(r.northing)}</td>
        <td>${cell(r.irishGridRef)}</td>
        <td>${cell(r.lat, 6)}</td>
        <td>${cell(r.lon, 6)}</td>
        <td>${cell(r.postcode)}</td>
        <td>${cell(r.itl1)}</td>
        <td>${cell(r.itl2)}</td>
        <td>${cell(r.itl3)}</td>
      </tr>`;
    })
    .join('');
}

// ---------------------------------------------------------------------
// Map
// ---------------------------------------------------------------------

function popupHtml(r) {
  const itlBreadcrumb = [r.itl1, r.itl2, r.itl3].filter(Boolean).map(escapeHtml).join(' &rsaquo; ');
  return (
    `<strong>${escapeHtml(r.input)}</strong><br/>${TYPE_LABELS[r.type] || r.type}<br/>` +
    `Lat/Lon: ${fmt(r.lat, 5)}, ${fmt(r.lon, 5)}<br/>` +
    (r.osGridRef ? `OS Grid: ${r.osGridRef}<br/>` : '') +
    (r.irishGridRef ? `Irish Grid: ${r.irishGridRef}<br/>` : '') +
    (r.postcode ? `Postcode: ${r.postcode}<br/>` : '') +
    (itlBreadcrumb ? `ITL Region: ${itlBreadcrumb}` : '')
  );
}

function addPointMarker(r, colour) {
  const marker = L.circleMarker([r.lat, r.lon], {
    radius: 7,
    color: colour,
    fillColor: colour,
    fillOpacity: 0.85,
    weight: 1.5,
  });
  marker.bindPopup(popupHtml(r));
  marker.addTo(markerLayer);
}

const REGION_LEVEL_LABELS = { area: 'area', district: 'district', sector: 'sector', unit: 'unit' };
const REGION_LEVEL_RANK = { area: 0, district: 1, sector: 2, unit: 3 };

/**
 * Mirrors postcodeParts() in src/boundaries.js just enough to predict which
 * boundary file a postcode+level will resolve to, without needing a network
 * round trip to find out. Real-world point sets are often geographically
 * clustered (e.g. tree-planting data across a few council areas) — lots of
 * different postcodes sharing the same district/area — so this lets
 * fetchBoundaryGeometry below dedupe by the *resolved* code, not just the
 * raw postcode string, catching the common "different postcode, same area"
 * case rather than only exact repeats.
 */
function boundaryCacheKey(postcode, regionSize) {
  const compact = (postcode || '').toUpperCase().replace(/\s+/g, '');
  const isFull = /^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/.test(compact);
  const outward = isFull ? compact.slice(0, -3) : compact;
  const inward = isFull ? compact.slice(-3) : null;
  const area = outward.match(/^[A-Z]{1,2}/)?.[0] || outward;
  switch (regionSize) {
    case 'area':
      return area;
    case 'sector':
      return inward ? `${outward} ${inward[0]}` : outward;
    case 'unit':
      return isFull ? compact : outward; // units are already ~unique per full postcode
    case 'district':
    default:
      return outward;
  }
}

// Caches in-flight/resolved boundary fetches by resolved code+level for the
// current renderMarkers() call, so 2000 points clustered into a handful of
// real districts/areas cost a handful of network requests, not 2000 —
// previously every point refetched (and rebuilt) the same geometry from
// scratch even when many shared the exact same underlying boundary.
let boundaryFetchCache = new Map();

/** Fetches (and caches) just the raw {geometry, level, requested} — no styling, no popup, no per-point info. */
function fetchBoundaryGeometry(postcode, regionSize) {
  const key = `${regionSize}:${boundaryCacheKey(postcode, regionSize)}`;
  if (boundaryFetchCache.has(key)) return boundaryFetchCache.get(key);

  const promise = fetch(`api/boundary/${encodeURIComponent(postcode)}?level=${encodeURIComponent(regionSize)}`).then(
    async (res) => (res.ok ? res.json() : null)
  );
  boundaryFetchCache.set(key, promise);
  return promise;
}

/**
 * Builds a boundary polygon (or illustrative circle fallback) for a
 * postcode, without adding it to the map yet — the caller adds layers in
 * coarsest-to-finest order once every lookup has resolved, so a finer
 * boundary (e.g. a sector) always ends up drawn on top of, and clickable
 * over, a coarser one (e.g. an area) it happens to overlap. Doing the
 * addTo() here instead, as each fetch resolves, would make the stacking
 * order depend on network timing — overlapping polygons would flicker
 * between which one is on top from one conversion to the next.
 */
async function buildPostcodeAreaLayer(r, colour, regionSize) {
  const code = (r.postcode || '').replace(/^~/, '');
  try {
    const body = await fetchBoundaryGeometry(code, regionSize);
    if (body) {
      const layer = L.geoJSON(body.geometry, {
        // smoothFactor (default 1.0) controls how aggressively Leaflet
        // simplifies each shape's vertices at the current zoom level before
        // drawing it — panning/zooming redraws every visible shape on every
        // frame, so with hundreds/thousands of multi-hundred-vertex region
        // polygons on screen, that per-frame cost is what makes moving the
        // map feel sluggish on a large batch. A higher factor trades a bit
        // of shape precision (imperceptible at the zoom levels this map
        // actually shows) for a much cheaper redraw.
        style: { color: colour, weight: 2, fillColor: colour, fillOpacity: 0.25, smoothFactor: 3 },
      });
      const levelNote =
        body.level === body.requested
          ? REGION_LEVEL_LABELS[body.level]
          : `${REGION_LEVEL_LABELS[body.level]} — "${REGION_LEVEL_LABELS[body.requested]}" wasn't available for this postcode`;
      layer.bindPopup(
        popupHtml(r) +
          `<br/><em>Experimental region boundary (${escapeHtml(levelNote)}) — approximate, not an official OS/ONS boundary.</em>`
      );
      return { layer, rank: REGION_LEVEL_RANK[body.level] ?? 0 };
    }
  } catch {
    // network error — fall through to the circle fallback below
  }

  const radius = AREA_RADIUS_METRES[regionSize] || 1000;
  const circle = L.circle([r.lat, r.lon], {
    radius,
    color: colour,
    fillColor: colour,
    fillOpacity: 0.15,
    weight: 1.5,
    dashArray: '4 4',
  });
  circle.bindPopup(
    popupHtml(r) +
      '<br/><em>No boundary dataset found for this postcode — illustrative circle only, not a real area. See data/postcode-boundaries/README.md.</em>'
  );
  return { layer: circle, rank: REGION_LEVEL_RANK[regionSize] ?? 0 };
}

// A large paste/CSV can mean hundreds of points needing a boundary lookup
// in Regions mode. Firing them all at once used to blow past the server's
// /api/boundary rate limit partway through a big batch — every request
// past that point got a 429, which looks identical to "no boundary data"
// at this end, so the map silently filled with illustrative circles
// instead of real polygons. That's now fixed properly at the source (the
// rate limit was raised to comfortably clear the app's 2000-line cap), so
// this is just a courtesy cap, not what's preventing the bug — kept high
// so small/typical conversions are unaffected (all points still fire in
// one go whenever there are fewer than this) and even large ones stay
// fast. Unlike convertBatch's postcodes.io calls (a third-party API that
// itself falls over under heavy concurrency), these all hit our own
// server, and the browser's own per-origin connection limit already caps
// how many are truly in flight at once regardless of this number.
const BOUNDARY_FETCH_CONCURRENCY = 32;

async function renderMarkers(results, { refit = true } = {}) {
  markerLayer.clearLayers();
  boundaryFetchCache = new Map(); // dedupe within this render pass only, not across the whole session
  const bounds = [];
  const regionSize = document.getElementById('region-size-select').value;
  const areaLayers = [];

  async function processResult(r) {
    if (r.lat == null || r.lon == null) return;
    bounds.push([r.lat, r.lon]);
    const colour = TYPE_COLOURS[r.type] || TYPE_COLOURS.unknown;

    // Any result with a resolved postcode gets region treatment in "Regions"
    // mode, not just ones that were *typed* as a postcode — e.g. an
    // Easting/Northing input that reverse-geocoded to a nearby postcode
    // should show that postcode's region too.
    if (displayStyle === 'area' && r.postcode) {
      areaLayers.push(await buildPostcodeAreaLayer(r, colour, regionSize));
    } else {
      addPointMarker(r, colour);
    }
  }

  let next = 0;
  async function worker() {
    while (next < results.length) {
      await processResult(results[next++]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(BOUNDARY_FETCH_CONCURRENCY, results.length) }, worker));

  areaLayers
    .sort((a, b) => a.rank - b.rank)
    .forEach(({ layer }) => layer.addTo(markerLayer));
  if (refit && bounds.length) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 12 });
}

document.querySelectorAll('input[name="display-style"]').forEach((el) => {
  el.addEventListener('change', (e) => {
    displayStyle = e.target.value;
    document.getElementById('region-size-row').hidden = displayStyle !== 'area';
    renderMarkers(lastResults, { refit: false });
  });
});

document.getElementById('region-size-select').addEventListener('change', () => {
  if (displayStyle === 'area') renderMarkers(lastResults, { refit: false });
});

// ---------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------

const EXPORT_HEADERS = [
  'Original Input',
  'Detected Type',
  'OS Grid Ref',
  'Easting (OSGB36)',
  'Northing (OSGB36)',
  'Irish Grid Ref',
  'Easting (Irish Grid)',
  'Northing (Irish Grid)',
  'Latitude (WGS84)',
  'Longitude (WGS84)',
  'Postcode',
  'ITL1',
  'ITL2',
  'ITL3',
  'Error',
];

/** Shared row data (as arrays, unescaped) for both the CSV and Excel exports. */
function toExportRows(results) {
  return results.map((r) => {
    const hasError = Boolean(r.error);
    const field = (v) => (v === null || v === undefined ? (hasError ? NOT_FOUND : '') : v);
    return [
      r.input,
      TYPE_LABELS[r.type] || r.type,
      field(r.osGridRef),
      field(r.easting),
      field(r.northing),
      field(r.irishGridRef),
      field(r.eastingIrish),
      field(r.northingIrish),
      field(r.lat),
      field(r.lon),
      field(r.postcode),
      field(r.itl1),
      field(r.itl2),
      field(r.itl3),
      r.error || '',
    ];
  });
}

function toCsv(results) {
  const escapeCsv = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = toExportRows(results).map((row) => row.map(escapeCsv).join(','));
  return [EXPORT_HEADERS.join(','), ...rows].join('\r\n');
}

function exportFilename(extension) {
  return `geospatial-conversion-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${extension}`;
}

function downloadCsv(results) {
  const csv = toCsv(results);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = exportFilename('csv');
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function downloadXlsx(results) {
  const worksheet = XLSX.utils.aoa_to_sheet([EXPORT_HEADERS, ...toExportRows(results)]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Conversions');
  XLSX.writeFile(workbook, exportFilename('xlsx'));
}

// ---------------------------------------------------------------------
// Convert
// ---------------------------------------------------------------------

async function convert() {
  const text = document.getElementById('input-text').value;
  const status = document.getElementById('status');
  const convertBtn = document.getElementById('convert-btn');
  const downloadBtn = document.getElementById('download-btn');
  const downloadXlsxBtn = document.getElementById('download-xlsx-btn');

  if (!text.trim()) {
    status.textContent = 'Paste some input first.';
    return;
  }

  convertBtn.disabled = true;
  downloadBtn.disabled = true;
  downloadXlsxBtn.disabled = true;
  status.textContent = 'Converting…';

  try {
    const res = await fetch('api/convert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Conversion failed');

    lastResults = body.results;
    renderTable(lastResults);
    await renderMarkers(lastResults);
    const errorCount = lastResults.filter((r) => r.error).length;
    status.textContent = `Converted ${lastResults.length} line(s)${errorCount ? `, ${errorCount} not found` : ''}.`;
    downloadBtn.disabled = lastResults.length === 0;
    downloadXlsxBtn.disabled = lastResults.length === 0;
  } catch (err) {
    status.textContent = `Error: ${err.message}`;
  } finally {
    convertBtn.disabled = false;
  }
}

document.getElementById('convert-btn').addEventListener('click', convert);
document.getElementById('download-btn').addEventListener('click', () => downloadCsv(lastResults));
document.getElementById('download-xlsx-btn').addEventListener('click', () => downloadXlsx(lastResults));

// ---------------------------------------------------------------------
// CSV upload + column picker
// ---------------------------------------------------------------------

let uploadedRows = []; // array of arrays — raw parsed CSV, including header row if present
let selectedColumns = []; // up to 2 column indices

/** Minimal RFC4180-ish CSV parser: handles quoted fields, embedded commas/quotes/newlines. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\r') {
      // ignore; \n (below) ends the row
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}

function getHeadersAndData() {
  if (uploadedRows.length === 0) return { headers: [], dataRows: [] };
  const hasHeader = document.getElementById('has-header-checkbox').checked;
  if (hasHeader) {
    return { headers: uploadedRows[0], dataRows: uploadedRows.slice(1) };
  }
  const colCount = uploadedRows[0].length;
  return { headers: Array.from({ length: colCount }, (_, i) => `Column ${i + 1}`), dataRows: uploadedRows };
}

function renderUploadPreview() {
  const { headers, dataRows } = getHeadersAndData();
  const table = document.getElementById('upload-preview-table');
  const previewRows = dataRows.slice(0, 5);
  const headRow = `<tr>${headers.map((h, i) => `<th>${escapeHtml(h || `Column ${i + 1}`)}</th>`).join('')}</tr>`;
  const bodyRows = previewRows
    .map((r) => `<tr>${headers.map((_, i) => `<td>${escapeHtml(r[i] ?? '')}</td>`).join('')}</tr>`)
    .join('');
  table.innerHTML = `<thead>${headRow}</thead><tbody>${bodyRows}</tbody>`;
}

function renderColumnPicker() {
  const { headers } = getHeadersAndData();
  const picker = document.getElementById('column-picker');
  picker.innerHTML = headers
    .map(
      (h, i) => `<label class="${selectedColumns.includes(i) ? 'selected' : ''}">
        <input type="checkbox" value="${i}" ${selectedColumns.includes(i) ? 'checked' : ''} /> ${escapeHtml(h || `Column ${i + 1}`)}
      </label>`
    )
    .join('');

  picker.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    cb.addEventListener('change', (e) => {
      const idx = Number(e.target.value);
      if (e.target.checked) {
        if (selectedColumns.length >= 2) {
          e.target.checked = false;
          document.getElementById('upload-status').textContent = 'You can select up to 2 columns.';
          return;
        }
        selectedColumns.push(idx);
        document.getElementById('upload-status').textContent = '';
      } else {
        selectedColumns = selectedColumns.filter((c) => c !== idx);
      }
      renderColumnPicker();
    });
  });

  renderUploadPreview();
}

function resetUploadPanel() {
  uploadedRows = [];
  selectedColumns = [];
  document.getElementById('upload-panel').hidden = true;
  document.getElementById('csv-file-input').value = '';
  document.getElementById('upload-status').textContent = '';
}

document.getElementById('upload-btn').addEventListener('click', () => {
  document.getElementById('csv-file-input').click();
});

/** When there's no real choice to make (1 or 2 columns total), pick for the user. */
function autoSelectColumns() {
  const { headers } = getHeadersAndData();
  if (headers.length === 1) {
    selectedColumns = [0];
  } else if (headers.length === 2) {
    selectedColumns = [0, 1];
  } else {
    selectedColumns = [];
  }
}

document.getElementById('csv-file-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const text = await file.text();
  uploadedRows = parseCsv(text);

  if (uploadedRows.length === 0) {
    document.getElementById('upload-status').textContent = 'Could not find any rows in that file.';
    return;
  }

  document.getElementById('upload-filename').textContent = `${file.name} (${uploadedRows.length} row(s) found)`;
  document.getElementById('upload-panel').hidden = false;
  autoSelectColumns();
  renderColumnPicker();
});

document.getElementById('has-header-checkbox').addEventListener('change', () => {
  // Column *indices* stay valid whether or not row 0 is treated as a
  // header — only the labels/preview change — so any columns the user has
  // already picked must be preserved here, not reset.
  renderColumnPicker();
});

document.getElementById('load-columns-btn').addEventListener('click', () => {
  if (selectedColumns.length === 0) {
    document.getElementById('upload-status').textContent = 'Select at least 1 column first.';
    return;
  }
  const { dataRows } = getHeadersAndData();
  const cols = [...selectedColumns].sort((a, b) => a - b);
  const lines = dataRows
    .map((r) => cols.map((i) => (r[i] ?? '').trim()).filter(Boolean).join(', '))
    .filter(Boolean);

  document.getElementById('input-text').value = lines.join('\n');
  // Deliberately leave the upload panel open (rather than resetting it) —
  // if the header checkbox or column choice turns out to be wrong once you
  // see the converted results, you can fix it and hit "Load & Convert"
  // again without re-uploading the file. "Cancel" or picking a new file
  // are the only things that actually clear this state.
  document.getElementById('upload-status').textContent = 'Converted below. Adjust settings above and reload if needed.';
  convert(); // loading columns in should go straight to converting, no extra click
});

document.getElementById('cancel-upload-btn').addEventListener('click', resetUploadPanel);

// The About/FAQ content stays in the page (good for SEO — collapsed
// content is indexed the same as visible content) but is hidden by
// default so it doesn't compete with the tool itself for attention.
document.getElementById('about-toggle').addEventListener('click', () => {
  const panel = document.getElementById('about-panel');
  const nowHidden = !panel.hidden;
  panel.hidden = nowHidden;
  document.getElementById('about-toggle').setAttribute('aria-expanded', String(!nowHidden));
  if (!nowHidden) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

initMap();
