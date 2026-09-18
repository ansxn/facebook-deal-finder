# Running the instance

Operator notes. Users never see any of this — they install the plugin and sign
up. This is for whoever owns the deployment.

- **Live URL:** https://deal-finder-zeta.vercel.app
- **Supabase project:** `deal-finder` (`eggzrvxidksjpzsegrnf`, ca-central-1)
- **Vercel project:** `deal-finder` under *anson's projects*, root directory `web`

## Environment variables

[Project Settings → Environment Variables](https://vercel.com/ansons-projects-129355d4/deal-finder/settings/environment-variables)

| Name | Required | What it does |
|---|---|---|
| `SUPABASE_URL` | yes | `https://eggzrvxidksjpzsegrnf.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | From [Supabase → Settings → API](https://supabase.com/dashboard/project/eggzrvxidksjpzsegrnf/settings/api) — the **service_role** key, not anon |
| `SESSION_SECRET` | no | Signs dashboard session cookies. Derived from the service key if unset; set it explicitly if you ever rotate that key and don't want everyone logged out. |
| `MAX_USERS` | no | Signup cap, default 25 |
| `SIGNUP_CODE` | no | If set, signup asks for this code |
| `SIGNUP_DISABLED` | no | Set to `1` to close signups entirely |
| `MAX_LISTINGS_PER_USER` | no | Per-account listing cap, default 20000 |
| `LISTINGS_LIMIT` | no | Rows `loadAll` will read, default 5000 |

**Set them for Preview as well as Production.** Vercel scopes variables per
environment, and a preview deployment without them returns a 500 from every
endpoint that touches the database — which looks exactly like a code bug and
isn't one.

The service role key bypasses row-level security. It is only ever read
server-side inside Vercel functions and never reaches the browser, which is why
the dashboard talks to `/api/*` instead of Supabase directly.

## Deployment Protection must stay off

[Deployment Protection settings](https://vercel.com/ansons-projects-129355d4/deal-finder/settings/deployment-protection)

With it on, every request gets a Vercel login page instead of JSON, so the hunt
fails with an unreadable HTML blob. The tool has its own authentication and does
not need Vercel's:

- **Signup** creates an account with a scrypt password hash, capped by
  `MAX_USERS` and optionally gated by `SIGNUP_CODE`.
- **The dashboard** authenticates with an HMAC-signed, HttpOnly session cookie.
- **The hunt** authenticates with a per-user push token (`dfp_` + 64 hex). Only
  the SHA-256 hash is stored; the token is shown once at signup and can be
  regenerated from the Account page.
- **Every row is scoped by `user_id`.** RLS is enabled with no policies as a
  backstop for a leaked anon key, but since the API holds the service role key
  the explicit filter is the real boundary — which is why reads go through
  `selectForUser`.

## Deploying

Vercel builds from git on every push to `master`. There is no build step, no
install step and no generated files — what is committed is what runs.

The root directory is `web`, so `web/vercel.json`, `web/package.json` and
`web/api/**` are what matter. Files outside `web/` are not deployed.

Preview deployments come from any other branch and are the right place to test
API changes before merging.

## Function budget

Hobby allows **12 serverless functions** per deployment and there are currently
9: `account, deals, ingest, login, run, searches, signup, status, verdict`.

Prefer a query parameter on an existing endpoint over a new file. That is why
`/api/searches` and `/api/deals` accept either a session cookie or a push token
rather than having separate machine endpoints, and why `?view=hunt` and
`?view=compact` are parameters rather than routes.

## Adding a user

They install the plugin and run `/deal-finder:setup`, which walks them through
signup themselves. Nothing to do at your end unless signups are capped or coded,
in which case raise `MAX_USERS` or send them the `SIGNUP_CODE`.

## Break glass

`scripts/admin/set-password.mjs` resets a password directly against the
database. It needs `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in a local
`.env.local` (gitignored) and Node installed — it is the one piece of local
tooling left, and only the operator ever needs it.

## What is still local, permanently

Browsing Marketplace. It needs a signed-in Chrome and a human at the keyboard,
which is the entire premise of the tool — see [ARCHITECTURE.md](ARCHITECTURE.md).
