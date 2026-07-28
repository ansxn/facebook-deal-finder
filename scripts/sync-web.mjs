#!/usr/bin/env node
// Copies the shared modules and the dashboard into web/ for deployment.
//
//   node scripts/sync-web.mjs
//
// The canonical copies live in scripts/lib/ and dashboard/. Vercel needs a
// self-contained tree, so they get duplicated here rather than imported across
// the project root. Generated files carry a header saying so — never edit them
// directly, the next sync overwrites them.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib/store.mjs';

const WEB = join(ROOT, 'web');
mkdirSync(join(WEB, 'api', '_lib'), { recursive: true });

const HEADER = (from) =>
  `// GENERATED — do not edit. Source of truth: ${from}\n` +
  `// Regenerate with: node scripts/sync-web.mjs\n\n`;

for (const name of ['score.mjs', 'fairvalue.mjs', 'supabase.mjs']) {
  const from = join('scripts', 'lib', name);
  writeFileSync(
    join(WEB, 'api', '_lib', name),
    HEADER(from) + readFileSync(join(ROOT, from), 'utf8')
  );
  console.log(`  api/_lib/${name}`);
}

// The dashboard is one file used in both places. It asks the server whether
// auth is required, so the same markup works behind the password gate on Vercel
// and wide open on localhost.
writeFileSync(join(WEB, 'index.html'), readFileSync(join(ROOT, 'dashboard', 'index.html'), 'utf8'));
console.log('  index.html');
console.log('\nweb/ is ready to deploy.');
