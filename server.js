const express = require('express');
const path = require('path');
const { convertBatch } = require('./src/convert');
const { loadBoundaries, findBoundary } = require('./src/boundaries');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

loadBoundaries();

app.post('/api/convert', async (req, res) => {
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

app.get('/api/boundary/:code', (req, res) => {
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
