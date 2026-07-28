#!/usr/bin/env node
// Local dashboard. No dependencies, no build step, no framework.
//
//   node scripts/serve.mjs          → http://localhost:3000
//   PORT=8080 node scripts/serve.mjs
//
// The API surface is deliberately tiny and JSON-only, so the same front-end can
// later be pointed at a hosted backend without touching the UI. See
// docs/HOSTING.md.

import { createServer } from 'node:http';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, extname } from 'node:path';
import { loadListings, loadSearches, loadVerdicts, saveSearches, setVerdict, ROOT, DATA } from './lib/store.mjs';
import { scoreAll } from './lib/score.mjs';
import { loadRuns } from './lib/store.mjs';

const PORT = Number(process.env.PORT ?? 3000);
const PUBLIC = join(ROOT, 'dashboard');
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml' };

const json = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new Error('body is not valid JSON'); }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  try {
    if (path === '/api/deals') {
      const searches = loadSearches();
      const all = scoreAll({
        listings: loadListings(),
        searches,
        verdicts: loadVerdicts(),
        includeDismissed: url.searchParams.get('dismissed') === 'true',
      });
      return json(res, 200, {
        deals: all,
        searches: searches.searches.map((s) => ({ id: s.id, label: s.label, active: s.active })),
        counts: all.reduce((acc, d) => ({ ...acc, [d.status]: (acc[d.status] ?? 0) + 1 }), {}),
      });
    }

    if (path === '/api/status') {
      const runs = loadRuns().runs;
      const last = runs.at(-1) ?? null;
      const minHours = loadSearches()?.global?.pacing?.min_hours_between_runs ?? 18;
      const hoursSince = last ? (Date.now() - new Date(last.started).getTime()) / 36e5 : null;
      return json(res, 200, {
        last_run: last,
        hours_since: hoursSince,
        min_hours: minHours,
        can_run: hoursSince == null || hoursSince >= minHours,
        total_runs: runs.length,
        // The local server binds to localhost and is never password gated —
        // the dashboard shares its markup with the hosted build, so it needs
        // to be told which one it's talking to.
        hosted: false,
        auth_required: false,
      });
    }

    // Exists only so the shared dashboard can call it unconditionally. There is
    // nothing to authenticate against on localhost.
    if (path === '/api/login' && req.method === 'POST') {
      return json(res, 200, { ok: true, note: 'local server — no password needed' });
    }

    if (path === '/api/searches' && req.method === 'GET') {
      return json(res, 200, loadSearches());
    }

    if (path === '/api/searches' && req.method === 'PUT') {
      const body = await readBody(req);
      saveSearches(body);
      return json(res, 200, { ok: true });
    }

    if (path === '/api/verdict' && req.method === 'POST') {
      const { id, state } = await readBody(req);
      if (!id || !state) return json(res, 400, { error: 'need { id, state }' });
      setVerdict(id, state);
      return json(res, 200, { ok: true, id, state });
    }

    // The dashboard cannot start a browse — it's code, and code can't drive
    // Chrome. All it can do is leave a note that the agent picks up. Honest
    // about that in the UI rather than pretending the button hunts.
    if (path === '/api/request-run' && req.method === 'POST') {
      mkdirSync(DATA, { recursive: true });
      const payload = { requested_at: new Date().toISOString(), source: 'dashboard' };
      writeFileSync(join(DATA, 'run-requested.json'), JSON.stringify(payload, null, 2) + '\n');
      return json(res, 200, { ...payload, command: '/hunt' });
    }

    if (path.startsWith('/api/')) return json(res, 404, { error: 'no such endpoint' });

    // Static files
    const file = path === '/' ? 'index.html' : path.slice(1);
    const full = join(PUBLIC, file);
    if (!full.startsWith(PUBLIC) || !existsSync(full)) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      return res.end('not found');
    }
    res.writeHead(200, { 'content-type': MIME[extname(full)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(readFileSync(full));
  } catch (err) {
    json(res, 500, { error: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`Deal finder dashboard → http://localhost:${PORT}`);
  const n = Object.keys(loadListings().listings ?? {}).length;
  console.log(n ? `${n} listings stored` : 'No listings yet — run /hunt in Claude Code to fill this.');
});
