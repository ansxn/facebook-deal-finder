#!/usr/bin/env node
// Pulls searches config edited on the website down to searches.json when the
// hosted copy is newer. Run at the start of every hunt so the browse follows
// what you set on the site.
//
//   node scripts/pull-config.mjs

import { apiEnv, pullConfig } from './lib/config-sync.mjs';

if (!apiEnv().configured) {
  console.log('no DEALFINDER_API_URL or DEALFINDER_PUSH_TOKEN in .env.local; local searches.json is the only copy');
  process.exit(0);
}

let r;
try { r = await pullConfig(); }
catch (err) {
  console.error(/→ 401/.test(err.message)
    ? 'The dashboard rejected the push token. Copy it again, or use Account > Regenerate on the website, then update DEALFINDER_PUSH_TOKEN in .env.local.'
    : `Could not reach the dashboard: ${err.message}`);
  process.exit(1);
}
const msg = {
  pulled: `pulled newer config from the dashboard (saved ${r.updated_at})`,
  'local-newer': 'local searches.json is newer than the dashboard copy; it is pushed at the end of the run',
  same: 'config already in sync',
  'no-remote': 'token works; no config on the dashboard yet',
}[r.action];
console.log(msg);
