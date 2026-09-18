# Architecture

## The one constraint that shapes everything

Facebook Marketplace has no API. Scraping it violates Meta's ToS and trips bot
detection. So **the browsing step is not code.** There is no headless browser, no
`fetch()` against facebook.com, no stored session cookie, no proxy.

Instead: Claude drives *your own already-signed-in Chrome* via Claude in Chrome,
the same way you would if you were clicking around yourself. A handful of
searches, once a day, at human pace.

The important follow-on is that **only** the browsing needs to be local.
Everything downstream is ordinary server work, so that is where it lives:

```
  ┌─────────────────────────────────────────────┐
  │  AGENT SIDE  (no code — a Claude skill)      │
  │  plugins/deal-finder/skills/hunt/            │
  │                                              │
  │  opens your Chrome → runs one search →       │
  │  reads result cards → opens listings →       │
  │  assesses each against your rules            │
  └────────────────────┬────────────────────────┘
                       │  POST /api/ingest
                       │  { search_id, listings[] }
                       ▼
  ┌─────────────────────────────────────────────┐
  │  SERVER SIDE  (Vercel + Supabase, no deps)   │
  │                                              │
  │  merge → dedupe → value → score → rank       │
  │  web/api/            web/api/_lib/           │
  └─────────────────────────────────────────────┘
```

A hunt is three calls: `POST /api/run {start}`, one `POST /api/ingest` per
search, `POST /api/run {finish}`. The ingest response carries the ranking back,
so there is nothing to read separately and no publish step to forget.

Everything on the server side is deterministic and testable without touching
Facebook at all — scoring and the merge rules are pure functions over
`(listing, config)`, so they can be iterated against saved fixtures, and only the
browse step needs a live run.

## Why the client keeps no database

An earlier version kept a local JSON store and pushed a copy to the server at the
end of each hunt. Two stores meant two implementations of the merge rules, a
sync step that could be forgotten (and was), and a Node install standing between
a new user and their first hunt.

One store removes all three. The cost is real and worth naming: there is no
offline mode. If the API is down, the hunt cannot run at all, where before it
could browse and sync later.

## Why not a scraper

Beyond the ToS problem, a headless scraper would need a stored Facebook session
to impersonate you — a durable credential sitting on disk, and exactly the shape
of traffic Meta's detection is tuned for. Driving the real browser means the
session stays where it already is, in Chrome, under your control, and the traffic
is indistinguishable from you browsing because it *is* you browsing.

## Pacing rules (non-negotiable)

- One run per day. `POST /api/run {start}` returns **409** if the last one was
  under `min_hours_between_runs` ago, so the gate is a refusal rather than a
  reading the caller can talk itself past. `force: true` exists and is the user's
  call, not the agent's.
- A run left open is closed automatically after two hours, so a crashed session
  cannot block tomorrow.
- Searches run sequentially, never in parallel.
- Human-scale pauses between page loads, longer between searches.
- A hard cap on listing detail pages opened per run.
- Any checkpoint, CAPTCHA, or "unusual activity" screen **aborts the run
  immediately** and surfaces to you. It never retries, never solves, never works
  around it.

## Data

| Stage | Lives in | Notes |
|---|---|---|
| Search config | `config` table, key `searches` | One copy. Edited by the website's sliders or by `/deal-finder:hunt-update`. |
| Listings | `listings` table | Keyed by `(user_id, marketplace id)`. `payload` holds the assessment and price history. |
| Scores | computed on read | Never stored. |
| Saved / passed | `verdicts` table | Your decisions survive re-scoring. |
| Run history | `runs` table | What the gate reads. |

Scores are derived, never stored as truth — so improving the scoring model
re-ranks your entire history instead of only affecting new listings, and moving
a slider on the website re-ranks before the page finishes loading.

Rows are scoped per user by an explicit `user_id` filter on every query. RLS is
enabled with no policies as a backstop for a leaked anon key; the API holds the
service role key and bypasses it, so the filter is the real boundary. Reads go
through `selectForUser` so it cannot be left out by accident.

## The merge rules

Re-seeing a listing is normal and is how price drops get noticed, so
`POST /api/ingest` merges rather than replaces:

- Dedupe on the Marketplace listing id, which survives edits to title and price.
- `first_seen` is never rewritten; `last_seen` always moves.
- `price_history` gains an entry only when the price actually changed.
- Non-empty incoming fields win, so a detail page beats a result card — but
  `price`, `price_history` and `assessment` are handled explicitly rather than
  falling through that loop. Letting `price` through it is what once wrote
  `"CA$325"` over `325` and scored nine live listings as `NaN`.
- Inside `assessment`, `must_have` and `nice_to_have` merge per spec, so a thin
  second pass cannot wipe what a richer first pass worked out.
