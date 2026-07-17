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
  map = L.map('map').setView([54.5, -3.5], 6);
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
        <td>${cell(r.region)}</td>
        <td>${cell(r.country)}</td>
      </tr>`;
    })
    .join('');
}

// ---------------------------------------------------------------------
// Map
// ---------------------------------------------------------------------

function popupHtml(r) {
  return (
    `<strong>${escapeHtml(r.input)}</strong><br/>${TYPE_LABELS[r.type] || r.type}<br/>` +
    `Lat/Lon: ${fmt(r.lat, 5)}, ${fmt(r.lon, 5)}<br/>` +
    (r.osGridRef ? `OS Grid: ${r.osGridRef}<br/>` : '') +
    (r.irishGridRef ? `Irish Grid: ${r.irishGridRef}<br/>` : '') +
    (r.postcode ? `Postcode: ${r.postcode}<br/>` : '') +
    (r.region ? `Region: ${r.region}` : '')
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

/** Draws a boundary polygon if the dataset has one at (or below) the requested level, else an illustrative circle. */
async function addPostcodeArea(r, colour, regionSize) {
  const code = (r.postcode || '').replace(/^~/, '');
  try {
    const res = await fetch(`api/boundary/${encodeURIComponent(code)}?level=${encodeURIComponent(regionSize)}`);
    if (res.ok) {
      const body = await res.json();
      const layer = L.geoJSON(body.geometry, {
        style: { color: colour, weight: 2, fillColor: colour, fillOpacity: 0.25 },
      });
      const levelNote =
        body.level === body.requested
          ? REGION_LEVEL_LABELS[body.level]
          : `${REGION_LEVEL_LABELS[body.level]} — "${REGION_LEVEL_LABELS[body.requested]}" wasn't available for this postcode`;
      layer.bindPopup(
        popupHtml(r) +
          `<br/><em>Experimental region boundary (${escapeHtml(levelNote)}) — approximate, not an official OS/ONS boundary.</em>`
      );
      layer.addTo(markerLayer);
      return;
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
  circle.addTo(markerLayer);
}

async function renderMarkers(results) {
  markerLayer.clearLayers();
  const bounds = [];
  const regionSize = document.getElementById('region-size-select').value;

  const jobs = results.map(async (r) => {
    if (r.lat == null || r.lon == null) return;
    bounds.push([r.lat, r.lon]);
    const colour = TYPE_COLOURS[r.type] || TYPE_COLOURS.unknown;

    // Any result with a resolved postcode gets region treatment in "Regions"
    // mode, not just ones that were *typed* as a postcode — e.g. an
    // Easting/Northing input that reverse-geocoded to a nearby postcode
    // should show that postcode's region too.
    if (displayStyle === 'area' && r.postcode) {
      await addPostcodeArea(r, colour, regionSize);
    } else {
      addPointMarker(r, colour);
    }
  });

  await Promise.all(jobs);
  if (bounds.length) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 12 });
}

document.querySelectorAll('input[name="display-style"]').forEach((el) => {
  el.addEventListener('change', (e) => {
    displayStyle = e.target.value;
    document.getElementById('region-size-row').hidden = displayStyle !== 'area';
    renderMarkers(lastResults);
  });
});

document.getElementById('region-size-select').addEventListener('change', () => {
  if (displayStyle === 'area') renderMarkers(lastResults);
});

// ---------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------

function toCsv(results) {
  const headers = [
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
    'Region',
    'Country',
    'Error',
  ];
  const escapeCsv = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = results.map((r) => {
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
      field(r.region),
      field(r.country),
      r.error || '',
    ]
      .map(escapeCsv)
      .join(',');
  });
  return [headers.join(','), ...rows].join('\r\n');
}

function downloadCsv(results) {
  const csv = toCsv(results);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `geospatial-conversion-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------
// Convert
// ---------------------------------------------------------------------

async function convert() {
  const text = document.getElementById('input-text').value;
  const status = document.getElementById('status');
  const convertBtn = document.getElementById('convert-btn');
  const downloadBtn = document.getElementById('download-btn');

  if (!text.trim()) {
    status.textContent = 'Paste some input first.';
    return;
  }

  convertBtn.disabled = true;
  downloadBtn.disabled = true;
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
  } catch (err) {
    status.textContent = `Error: ${err.message}`;
  } finally {
    convertBtn.disabled = false;
  }
}

document.getElementById('convert-btn').addEventListener('click', convert);
document.getElementById('download-btn').addEventListener('click', () => downloadCsv(lastResults));

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
  resetUploadPanel();
  convert(); // loading columns in should go straight to converting, no extra click
});

document.getElementById('cancel-upload-btn').addEventListener('click', resetUploadPanel);

initMap();
