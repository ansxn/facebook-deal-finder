// Two-way config sync between the laptop's searches.json and the hosted copy.
//
// The website is where thresholds, ceilings and dealbreakers get tuned now, so
// before a hunt (and before a push) the newer of the two copies has to win.
// Both sides stamp `updated_at` on save; a missing stamp counts as oldest.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadSearches, saveSearches, ROOT } from './store.mjs';

export function loadDotEnv() {
  const path = join(ROOT, '.env.local');
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    const value = m[2].trim().replace(/^["']|["']$/g, '');
    if (!process.env[m[1]]) process.env[m[1]] = value;
  }
}

export function apiEnv() {
  loadDotEnv();
  const apiUrl = (process.env.DEALFINDER_API_URL ?? '').replace(/\/$/, '');
  const token = process.env.DEALFINDER_PUSH_TOKEN;
  return { apiUrl, token, configured: Boolean(apiUrl && token) };
}

export async function apiCall(method, path, body) {
  const { apiUrl, token } = apiEnv();
  const res = await fetch(`${apiUrl}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed;
  try { parsed = text ? JSON.parse(text) : {}; }
  catch {
    throw new Error(
      `${method} ${path} → ${res.status}: non-JSON response. If this is a\n` +
      'Vercel login page, the deployment still has Deployment Protection on —\n' +
      'turn it off in Vercel → Settings → Deployment Protection.'
    );
  }
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${parsed.error ?? text.slice(0, 200)}`);
  return parsed;
}

const stamp = (cfg) => (cfg?.updated_at ? new Date(cfg.updated_at).getTime() : 0);

/**
 * Pull the hosted config and, if it is newer than searches.json, write it over
 * the local file. Returns what happened so callers can print one line.
 */
export async function pullConfig() {
  const remote = await apiCall('GET', '/api/pull-config');
  const local = loadSearches();
  if (!remote?.searches) return { action: 'no-remote' };
  const remoteAt = remote.updated_at ? new Date(remote.updated_at).getTime() : 0;
  const localAt = stamp(local);
  if (!local) { saveSearches(remote.searches); return { action: 'pulled', updated_at: remote.updated_at }; }
  if (remoteAt > localAt) { saveSearches(remote.searches); return { action: 'pulled', updated_at: remote.updated_at }; }
  if (remoteAt < localAt) return { action: 'local-newer', updated_at: local.updated_at };
  return { action: 'same' };
}
