-- Multi-tenant: user accounts, and a user_id on every data table.
--
-- This migration is also the data migration for the original single-user
-- deployment: every existing row is backfilled onto the owner's user row,
-- which is seeded with a fixed uuid so the backfill is deterministic. The
-- seeded password_hash is a placeholder that can never verify — run
-- `node scripts/admin/set-password.mjs <email>` to set a real one.
--
-- Marketplace listing ids are only unique per Facebook, not per user of this
-- tool — two users hunting the same city will both see listing 12345 — so
-- every primary key becomes composite with user_id.

create extension if not exists pgcrypto;

create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(email)),
  password_hash text not null,
  push_token_hash text,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

insert into users (id, email, password_hash, is_admin)
values ('00000000-0000-0000-0000-000000000001', 'ansonwang20@gmail.com', 'RESET-ME', true);

-- listings: (user_id, id)
alter table listings add column user_id uuid;
update listings set user_id = '00000000-0000-0000-0000-000000000001';
alter table listings
  alter column user_id set not null,
  add constraint listings_user_fk foreign key (user_id) references users(id) on delete cascade;
alter table listings drop constraint listings_pkey;
alter table listings add primary key (user_id, id);

-- verdicts: (user_id, listing_id)
alter table verdicts add column user_id uuid;
update verdicts set user_id = '00000000-0000-0000-0000-000000000001';
alter table verdicts
  alter column user_id set not null,
  add constraint verdicts_user_fk foreign key (user_id) references users(id) on delete cascade;
alter table verdicts drop constraint verdicts_pkey;
alter table verdicts add primary key (user_id, listing_id);

-- config: (user_id, key)
alter table config add column user_id uuid;
update config set user_id = '00000000-0000-0000-0000-000000000001';
alter table config
  alter column user_id set not null,
  add constraint config_user_fk foreign key (user_id) references users(id) on delete cascade;
alter table config drop constraint config_pkey;
alter table config add primary key (user_id, key);

-- runs: (user_id, started)
alter table runs add column user_id uuid;
update runs set user_id = '00000000-0000-0000-0000-000000000001';
alter table runs
  alter column user_id set not null,
  add constraint runs_user_fk foreign key (user_id) references users(id) on delete cascade;
alter table runs drop constraint runs_pkey;
alter table runs add primary key (user_id, started);

-- Default-deny RLS. The API talks to Postgres with the service role key, which
-- bypasses RLS; enabling it with no policies means the anon/publishable keys
-- can read nothing if they ever leak into a client.
alter table users enable row level security;
alter table listings enable row level security;
alter table verdicts enable row level security;
alter table config enable row level security;
alter table runs enable row level security;
