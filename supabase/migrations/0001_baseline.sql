-- Baseline: the four tables the dashboard has used since the first hosted
-- deploy. Codified here so a fresh Supabase project can be set up from the
-- repo instead of by archaeology. Safe to run against the existing project —
-- everything is IF NOT EXISTS.

create table if not exists listings (
  id text primary key,
  search_id text,
  payload jsonb,
  first_seen timestamptz,
  last_seen timestamptz
);

create table if not exists verdicts (
  listing_id text primary key,
  state text,
  updated_at timestamptz
);

create table if not exists config (
  key text primary key,
  payload jsonb,
  updated_at timestamptz
);

create table if not exists runs (
  started timestamptz primary key,
  finished timestamptz,
  payload jsonb
);
