# Hosted setup

The dashboard is deployed. It needs three environment variables before it can
talk to the database, and they have to be set by you — the Supabase service role
key is a secret that should go straight from Supabase into Vercel without
passing through a chat transcript.

- **Live URL:** https://deal-finder-ansons-projects-129355d4.vercel.app
- **Supabase project:** `deal-finder` (`eggzrvxidksjpzsegrnf`, ca-central-1)
- **Vercel project:** `deal-finder` under *anson's projects*

## 1. Set the Vercel environment variables

[Project Settings → Environment Variables](https://vercel.com/ansons-projects-129355d4/deal-finder/settings/environment-variables)

| Name | Value |
|---|---|
| `SUPABASE_URL` | `https://eggzrvxidksjpzsegrnf.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | From [Supabase → Settings → API](https://supabase.com/dashboard/project/eggzrvxidksjpzsegrnf/settings/api) — the **service_role** key, not anon |
| `DASHBOARD_PASSWORD` | Anything you'll remember |

Then redeploy (Deployments → ⋯ → Redeploy) so the functions pick them up.

The service role key bypasses row-level security. It is only ever read
server-side inside Vercel functions and never reaches the browser — that's why
the dashboard talks to `/api/*` instead of Supabase directly.

## 2. Set the same values locally

`scripts/push.mjs` writes to the same database, so it needs the same two values.
Create `.env.local` in the project root (already gitignored):

```
SUPABASE_URL=https://eggzrvxidksjpzsegrnf.supabase.co
SUPABASE_SERVICE_ROLE_KEY=paste-the-same-key-here
```

## 3. Push your existing data

```bash
node scripts/push.mjs
```

That uploads the 15 stored golf listings, your searches config, and the run
history. The hosted dashboard is empty until you do this.

## 4. Decide how the URL is protected

**Right now the URL redirects to a Vercel login.** Vercel turns on Deployment
Protection for new projects, so only someone signed into your Vercel account can
reach it at all.

That's the strongest option, and it costs nothing — but it means signing into
Vercel in your phone's browser. Two ways to go:

- **Keep it.** Belt and braces: Vercel auth *and* the password gate. Best
  privacy, slightly more friction on a phone.
- **Turn it off** at [Deployment Protection settings](https://vercel.com/ansons-projects-129355d4/deal-finder/settings/deployment-protection)
  and rely on `DASHBOARD_PASSWORD`. The password gate is real — HMAC cookie,
  constant-time comparison, 90-day session — but it is one shared password in
  front of your location and buying history. Use something long.

Do **not** turn off protection without setting `DASHBOARD_PASSWORD` first. With
neither, every listing you've hunted is on an open URL.

## The daily loop, hosted

```bash
/hunt                      # in Claude Code, with Chrome signed in
node scripts/push.mjs      # send results up
```

Then open the URL from anywhere. Save and Dismiss work from the phone and sync
back down on the next push.

## Redeploying after code changes

```bash
node scripts/sync-web.mjs
```

That regenerates `web/` from `scripts/lib/` and `dashboard/`. Deploy that folder
with the Vercel CLI (`vercel --prod` from `web/`), or ask Claude to redeploy.

## What is still local, permanently

Browsing Marketplace. It needs your signed-in Chrome and a human at the keyboard,
which is the entire premise of the tool — see
[ARCHITECTURE.md](ARCHITECTURE.md). Hosting moved the reading half, not the
hunting half.
