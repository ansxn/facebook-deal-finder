#!/usr/bin/env node
// Sets (or resets) a user's dashboard password, straight against Supabase.
//
//   node scripts/admin/set-password.mjs you@example.com
//
// Owner-only break-glass tool: it needs the service role key in .env.local,
// which friends of a hosted instance never have. Used once after the
// multi-tenant migration to replace the seeded RESET-ME placeholder, and any
// time someone forgets their password.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, scryptSync } from 'node:crypto';
import { select, update } from '../lib/supabase.mjs';
import { ROOT } from '../lib/store.mjs';

loadDotEnv();

const email = String(process.argv[2] ?? '').trim().toLowerCase();
if (!email) {
  console.error('usage: node scripts/admin/set-password.mjs <email>');
  process.exit(1);
}

const rows = await select('users', `select=id,email&email=eq.${encodeURIComponent(email)}`);
if (!rows?.length) {
  console.error(`no user with email ${email}`);
  process.exit(1);
}

const password = await promptHidden(`New password for ${email} (min 10 chars): `);
if (password.length < 10) {
  console.error('too short — 10 characters minimum');
  process.exit(1);
}

// Format must match verifyPassword in web/api/_lib/auth.mjs.
const salt = randomBytes(32);
const hash = scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 });
const stored = `scrypt$16384$8$1$${salt.toString('base64')}$${hash.toString('base64')}`;

await update('users', `id=eq.${rows[0].id}`, { password_hash: stored });
console.log(`password updated for ${email}`);

function promptHidden(question) {
  return new Promise((resolve) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    stdin.resume();
    stdin.setRawMode?.(true);
    let value = '';
    const onData = (buf) => {
      const ch = buf.toString('utf8');
      if (ch === '\r' || ch === '\n' || ch === '') {
        stdin.setRawMode?.(false);
        stdin.pause();
        stdin.off('data', onData);
        process.stdout.write('\n');
        resolve(value);
      } else if (ch === '') {
        process.exit(130);
      } else if (ch === '' || ch === '\b') {
        value = value.slice(0, -1);
      } else {
        value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

// Same minimal .env.local reader as scripts/push.mjs.
function loadDotEnv() {
  const path = join(ROOT, '.env.local');
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    const value = m[2].trim().replace(/^["']|["']$/g, '');
    if (!process.env[m[1]]) process.env[m[1]] = value;
  }
}
