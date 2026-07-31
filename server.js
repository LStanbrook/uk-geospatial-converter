const express = require('express');
const path = require('path');
const rateLimit = require('express-rate-limit');
const { convertBatch } = require('./src/convert');
const { loadBoundaries, findBoundary } = require('./src/boundaries');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1); // behind Nginx — use X-Forwarded-For for rate-limit keys, not the proxy's own IP

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

loadBoundaries();

// A single /api/convert request can already carry up to 2000 lines (each
// triggering a postcodes.io lookup), so the limit here is on *requests*,
// not lines — generous enough for real bulk-paste/CSV use, tight enough to
// stop a script from repeatedly re-firing large batches.
const convertLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many conversion requests — please slow down and try again shortly.' },
});

// A single "Regions" map render can legitimately fire one /api/boundary
// request per converted point in a short burst — and /api/convert allows
// up to 2000 lines per request, so this needs to comfortably clear that.
// 2500 turned out to still be too tight in practice: switching region size
// a couple of times in quick succession while testing (e.g. Unit, then
// Area) fires up to 2000 requests *each* time, and the cumulative total
// within the same 60s window ran past 2500, silently falling back to
// illustrative circles for the remainder — indistinguishable from "no
// boundary data" at the UI level (see buildPostcodeAreaLayer in app.js).
// Unlike postcodes.io, this endpoint only ever reads our own bundled
// static files, so there's no real cost to being generous here — the
// limit exists to blunt a scripted flood, not to ration a cheap local read.
const boundaryLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many boundary requests — please slow down and try again shortly.' },
});

app.post('/api/convert', convertLimiter, async (req, res) => {
  const { text } = req.body || {};
  if (typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'Request body must include a non-empty "text" field.' });
  }

  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length > 2000) {
    return res.status(400).json({ error: 'Too many lines — limit is 2000 per request.' });
  }

  try {
    const results = await convertBatch(lines);
    res.json({ results });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Conversion failed.' });
  }
});

const BOUNDARY_LEVELS = ['area', 'district', 'sector', 'unit'];

app.get('/api/boundary/:code', boundaryLimiter, (req, res) => {
  const level = BOUNDARY_LEVELS.includes(req.query.level) ? req.query.level : 'district';
  const found = findBoundary(req.params.code, level);
  if (!found) {
    return res.status(404).json({ error: 'No boundary polygon available for this postcode.' });
  }
  res.json({ ...found, requested: level });
});

app.get('/healthz', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`UK Geospatial Converter listening on http://localhost:${PORT}`);
});
