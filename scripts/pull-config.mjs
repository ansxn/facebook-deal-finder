#!/usr/bin/env node
// Pulls searches config edited on the website down to searches.json when the
// hosted copy is newer. Run at the start of every hunt so the browse follows
// what you set on the site.
//
//   node scripts/pull-config.mjs

import { apiEnv, pullConfig } from './lib/config-sync.mjs';

if (!apiEnv().configured) {
  console.log('no DEALFINDER_API_URL / DEALFINDER_PUSH_TOKEN in .env.local — local searches.json is the only copy');
  process.exit(0);
}

const r = await pullConfig();
const msg = {
  pulled: `pulled newer config from the dashboard (saved ${r.updated_at})`,
  'local-newer': 'local searches.json is newer than the dashboard copy — it will be pushed at the end of the run',
  same: 'config already in sync',
  'no-remote': 'no config on the dashboard yet — local searches.json is the only copy',
}[r.action];
console.log(msg);
