const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { URL } = require('node:url');

const ROOT_DIR = __dirname;
const DATA_DIR = path.join(ROOT_DIR, 'data');
const SEED_STATS_PATH = path.join(DATA_DIR, 'kapi-stats.json');
const LOCAL_CHECKPOINT_PATH = path.join(DATA_DIR, '.kapi-stats-runtime.json');
const PORT = Number(process.env.PORT || 5173);
const HOST = process.env.HOST || '0.0.0.0';
const CHECKPOINT_INTERVAL_MS = Number(process.env.STATS_CHECKPOINT_INTERVAL_MS || 3 * 60 * 60 * 1000);

const DEFAULT_STATS = {
  updatedAt: '2026-05-17T00:00:00-03:00',
  people: {
    base: 13904,
    growthPerMinute: 0.38,
    maxRandomStep: 2
  },
  totalSaved: {
    baseCents: 231189851,
    growthCentsPerMinute: 173,
    maxRandomStepCents: 999
  }
};

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml'
};

let seedStatsPromise;
let poolPromise;
let ensuredDatabase = false;

function securityHeaders(extra = {}) {
  return {
    'X-Frame-Options': 'sameorigin',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    ...extra
  };
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, securityHeaders({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  }));
  res.end(JSON.stringify(payload));
}

function sendNoContent(res) {
  res.writeHead(204, securityHeaders({
    'Cache-Control': 'no-store'
  }));
  res.end();
}

async function loadSeedStats() {
  if (!seedStatsPromise) {
    seedStatsPromise = fs.readFile(SEED_STATS_PATH, 'utf8')
      .then((raw) => ({ ...DEFAULT_STATS, ...JSON.parse(raw) }))
      .catch(() => DEFAULT_STATS);
  }
  return seedStatsPromise;
}

function seedCheckpoint(seed) {
  return {
    people: Number(seed.people?.base) || DEFAULT_STATS.people.base,
    totalSavedCents: Number(seed.totalSaved?.baseCents) || DEFAULT_STATS.totalSaved.baseCents,
    updatedAt: seed.updatedAt || DEFAULT_STATS.updatedAt
  };
}

function advanceCheckpoint(checkpoint, seed) {
  const previousUpdatedAt = Date.parse(checkpoint.updatedAt);
  const now = Date.now();
  const minutes = Number.isFinite(previousUpdatedAt)
    ? Math.max(0, (now - previousUpdatedAt) / 60000)
    : 0;
  const peopleGrowth = Number(seed.people?.growthPerMinute) || DEFAULT_STATS.people.growthPerMinute;
  const savedGrowth = Number(seed.totalSaved?.growthCentsPerMinute) || DEFAULT_STATS.totalSaved.growthCentsPerMinute;
  const seedValues = seedCheckpoint(seed);
  const values = {
    people: Math.max(
      seedValues.people,
      Number(checkpoint.people) || 0,
      Math.floor((Number(checkpoint.people) || seedValues.people) + minutes * peopleGrowth)
    ),
    totalSavedCents: Math.max(
      seedValues.totalSavedCents,
      Number(checkpoint.totalSavedCents) || 0,
      Math.floor((Number(checkpoint.totalSavedCents) || seedValues.totalSavedCents) + minutes * savedGrowth)
    ),
    updatedAt: checkpoint.updatedAt
  };

  return {
    values,
    shouldCheckpoint: !Number.isFinite(previousUpdatedAt) || now - previousUpdatedAt >= CHECKPOINT_INTERVAL_MS
  };
}

function statsResponse(values, seed, source) {
  return {
    updatedAt: values.updatedAt,
    persisted: source === 'postgres',
    source,
    checkpointIntervalMs: CHECKPOINT_INTERVAL_MS,
    people: {
      base: values.people,
      growthPerMinute: Number(seed.people?.growthPerMinute) || DEFAULT_STATS.people.growthPerMinute,
      maxRandomStep: Number(seed.people?.maxRandomStep) || DEFAULT_STATS.people.maxRandomStep
    },
    totalSaved: {
      baseCents: values.totalSavedCents,
      growthCentsPerMinute: Number(seed.totalSaved?.growthCentsPerMinute) || DEFAULT_STATS.totalSaved.growthCentsPerMinute,
      maxRandomStepCents: Number(seed.totalSaved?.maxRandomStepCents) || DEFAULT_STATS.totalSaved.maxRandomStepCents
    }
  };
}

async function getPool() {
  if (!process.env.DATABASE_URL) return null;
  if (!poolPromise) {
    poolPromise = import('pg').then(({ Pool }) => new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL.includes('sslmode=require')
        ? { rejectUnauthorized: false }
        : undefined
    }));
  }
  return poolPromise;
}

async function ensureDatabase(pool) {
  if (ensuredDatabase) return;
  await pool.query(`
    create table if not exists kapi_stats (
      id text primary key,
      people integer not null,
      total_saved_cents bigint not null,
      updated_at timestamptz not null
    )
  `);
  ensuredDatabase = true;
}

async function readPostgresCheckpoint(pool) {
  await ensureDatabase(pool);
  const result = await pool.query(
    'select people, total_saved_cents, updated_at from kapi_stats where id = $1',
    ['global']
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    people: Number(row.people),
    totalSavedCents: Number(row.total_saved_cents),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at)
  };
}

async function writePostgresCheckpoint(pool, values) {
  await ensureDatabase(pool);
  await pool.query(`
    insert into kapi_stats (id, people, total_saved_cents, updated_at)
    values ($1, $2, $3, $4)
    on conflict (id) do update set
      people = greatest(kapi_stats.people, excluded.people),
      total_saved_cents = greatest(kapi_stats.total_saved_cents, excluded.total_saved_cents),
      updated_at = excluded.updated_at
  `, ['global', values.people, values.totalSavedCents, values.updatedAt]);
}

async function readLocalCheckpoint() {
  try {
    const raw = await fs.readFile(LOCAL_CHECKPOINT_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeLocalCheckpoint(values) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(LOCAL_CHECKPOINT_PATH, JSON.stringify(values, null, 2));
}

async function getStats() {
  const seed = await loadSeedStats();
  const pool = await getPool();

  if (pool) {
    const checkpoint = await readPostgresCheckpoint(pool) || seedCheckpoint(seed);
    const { values, shouldCheckpoint } = advanceCheckpoint(checkpoint, seed);
    if (shouldCheckpoint) {
      values.updatedAt = new Date().toISOString();
      await writePostgresCheckpoint(pool, values);
    }
    return statsResponse(values, seed, 'postgres');
  }

  const checkpoint = await readLocalCheckpoint() || seedCheckpoint(seed);
  const { values, shouldCheckpoint } = advanceCheckpoint(checkpoint, seed);
  if (shouldCheckpoint) {
    values.updatedAt = new Date().toISOString();
    await writeLocalCheckpoint(values);
  }
  return statsResponse(values, seed, 'local-file');
}

function resolveStaticPath(requestPathname) {
  let pathname;
  try {
    pathname = decodeURIComponent(requestPathname);
  } catch {
    return null;
  }
  if (pathname === '/') pathname = '/index.html';
  const resolved = path.normalize(path.join(ROOT_DIR, pathname));
  if (!resolved.startsWith(ROOT_DIR + path.sep)) return null;
  return resolved;
}

async function serveStatic(req, res, pathname) {
  const filePath = resolveStaticPath(pathname);
  if (!filePath) {
    res.writeHead(400, securityHeaders({ 'Content-Type': 'text/plain; charset=utf-8' }));
    res.end('Bad request');
    return;
  }

  try {
    const body = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const headers = securityHeaders({
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream'
    });
    if (pathname.startsWith('/assets/')) {
      headers['Cache-Control'] = 'public, max-age=31536000, immutable';
    }
    res.writeHead(200, headers);
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    res.end(body);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'EISDIR') {
      res.writeHead(404, securityHeaders({ 'Content-Type': 'text/plain; charset=utf-8' }));
      res.end('Not found');
      return;
    }
    console.error(error);
    res.writeHead(500, securityHeaders({ 'Content-Type': 'text/plain; charset=utf-8' }));
    res.end('Internal server error');
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/healthz') {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (url.pathname === '/api/stats') {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, securityHeaders({ Allow: 'GET, HEAD' }));
      res.end();
      return;
    }
    try {
      const stats = await getStats();
      sendJson(res, 200, stats);
    } catch (error) {
      console.error(error);
      sendJson(res, 500, { error: 'stats_unavailable' });
    }
    return;
  }

  if (url.pathname === '/api/qr-open') {
    sendNoContent(res);
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, securityHeaders({ Allow: 'GET, HEAD' }));
    res.end();
    return;
  }

  await serveStatic(req, res, url.pathname);
});

server.listen(PORT, HOST, () => {
  console.log(`Kapivara landing listening on ${HOST}:${PORT}`);
});
