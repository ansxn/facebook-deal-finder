# Hosting the dashboard (Vercel and friends)

Short answer: **yes, the dashboard can go on Vercel.** The browse step can't, and
never will — so hosting splits the tool across two machines and adds a sync
problem that doesn't exist today.

## What can and can't move

| Piece | Can it be hosted? |
|---|---|
| Dashboard UI | Yes — it's static HTML with a tiny JSON API |
| Scoring, dedupe, fair value | Yes — plain functions, no local state beyond the JSON files |
| **Browsing Marketplace** | **No.** It needs your signed-in Chrome, on your machine, driven by Claude |

So the hunt always runs locally. Hosting only changes *where you read results*.

## Option A — Vercel + Supabase (real phone access)

The browse run writes to Supabase instead of `data/listings.json`; Vercel serves
the dashboard against it.

- You can check deals from your phone, away from the machine
- Requires a Supabase project and swapping `scripts/lib/store.mjs` for a client —
  that file is the only thing that touches storage, which is why it's isolated
- **You must add auth.** Vercel deployments are public by default. Without a
  login, your location, what you're hunting, and your saved listings are on a
  guessable URL. Vercel's password protection is a paid feature; otherwise put
  Auth0/Clerk/Supabase Auth in front of it.

## Option B — Vercel + committed data (simplest hosted)

The run commits `data/listings.json` to the private repo; Vercel redeploys on
push and serves it as a static file.

- No database, no auth code, and the repo is already private
- Data is only as fresh as the last push, and every run adds a commit
- Still needs deployment protection so the Vercel URL isn't public

## Option C — keep it local, reach it from your phone

Tailscale (or `ngrok`) points your phone at `localhost:3000` over a private
network. No hosting, no sync, no auth to build, nothing leaves your machine.

For a once-a-day personal tool, **this is the one I'd pick.** It gets you the
actual thing you want — deals on your phone — without splitting the data layer
or putting your hunting history on the public internet.

## The catch nobody expects

Hosting makes the **"Run now" button worse, not better.**

Locally the button leaves a flag file that Claude can see next time you talk to
it. A hosted dashboard can't touch your laptop at all, so the button would need
your machine to poll the server for pending requests — a background daemon whose
only job is to notice you pressed a button on your phone, so that it can ask you
to go open your laptop and run the hunt anyway.

At which point you may as well just say `/hunt`.

## If you want Option A anyway

The seam is already in place. `scripts/lib/store.mjs` is the single module that
reads and writes data — swap its six exported functions for Supabase queries and
nothing else in the codebase changes. `scripts/serve.mjs` becomes Vercel
serverless routes with the same paths (`/api/deals`, `/api/verdict`,
`/api/searches`, `/api/status`), and `dashboard/index.html` ships unchanged
because it only ever speaks JSON to those four endpoints.

## Now built

Option A is live. Setup steps and the security decision: [SETUP-HOSTING.md](SETUP-HOSTING.md).
