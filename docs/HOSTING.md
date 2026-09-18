# Hosting: the options, and what was chosen

A decision record. Written before anything was hosted, kept because the reasoning
still explains the shape of the system — and because the option that won was not
the one recommended at the time.

**Outcome: Option A, and then further.** Not only the dashboard moved to the
server but ingest and the run gate too, so the client keeps no data at all. See
the closing section.

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
- Requires a Supabase project and moving the storage layer behind an API — the
  local store was a single module for exactly this reason
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

## What actually happened

Option A shipped, and Option C's advice turned out to be wrong for one reason the
table above misses: **the local half was the onboarding cost.** Reading results
on a phone was never the binding constraint. Getting a non-developer to install a
runtime, clone a repo and hand-write a credentials file was.

So the split moved further than Option A described. Ingest, dedupe, valuation,
scoring and the run gate all run on the server; the client keeps nothing. That
removed the sync problem this document opens by warning about — there is no
second copy to reconcile, and no push step to forget — and cut setup to two
commands.

The "catch nobody expects" above still stands, and the Run-now button was never
built for exactly that reason.

What it cost: there is no offline mode. If Vercel or Supabase is down, the hunt
cannot run, where a local store could have browsed and synced later. For a
once-a-day tool that trade reads as worth it, but it is a real regression and the
onboarding doc says so plainly.

Setup steps and the security decisions: [SETUP-HOSTING.md](SETUP-HOSTING.md).
Current design: [ARCHITECTURE.md](ARCHITECTURE.md).
