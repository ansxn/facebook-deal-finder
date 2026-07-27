# Architecture

## The one constraint that shapes everything

Facebook Marketplace has no API. Scraping it violates Meta's ToS and trips bot
detection. So **the browsing step is not code.** There is no headless browser, no
`fetch()` against facebook.com, no stored session cookie, no proxy.

Instead: Claude drives *your own already-signed-in Chrome* via Claude in Chrome,
the same way you would if you were clicking around yourself. A handful of
searches, once a day, at human pace.

This splits the system cleanly in two:

```
  ┌─────────────────────────────────────────────┐
  │  AGENT SIDE  (no code — a Claude skill)      │
  │  .claude/skills/browse-marketplace/          │
  │                                              │
  │  opens your Chrome → runs one search →       │
  │  reads result cards → opens listings →       │
  │  hands back structured JSON                  │
  └────────────────────┬────────────────────────┘
                       │  listings[]
                       ▼
  ┌─────────────────────────────────────────────┐
  │  CODE SIDE  (plain Node, no deps)            │
  │                                              │
  │  ingest → dedupe → score → store → serve     │
  │  scripts/            data/       dashboard/  │
  └─────────────────────────────────────────────┘
```

Everything on the code side is deterministic, testable, and runnable without
touching Facebook at all. That matters: it means scoring and the dashboard can be
iterated on against saved fixtures, and only the browse step needs a live run.

## Why not a scraper

Beyond the ToS problem, a headless scraper would need a stored Facebook session
to impersonate you — a durable credential sitting on disk, and exactly the shape
of traffic Meta's detection is tuned for. Driving the real browser means the
session stays where it already is, in Chrome, under your control, and the traffic
is indistinguishable from you browsing because it *is* you browsing.

## Pacing rules (non-negotiable)

These are enforced in the browse skill, not left to judgment:

- One run per day. The run refuses to start if the last one was < 18h ago.
- Searches run sequentially, never in parallel.
- Randomized human-scale pauses between page loads, longer between searches.
- A hard cap on listing detail pages opened per run.
- Any checkpoint, CAPTCHA, or "unusual activity" screen **aborts the run
  immediately** and surfaces to you. It never retries, never solves, never
  works around it.

## Data flow

| Stage | Lives in | Notes |
|---|---|---|
| Search config | `searches.json` | Hand-editable. The dashboard writes it too. |
| Raw listings | `data/listings.json` | Append-only-ish; keyed by Marketplace listing id. |
| Fair-value refs | `searches.json` + `data/comps.json` | Seeded per item, refined from web comps. |
| Scores | computed | Recomputed on demand, never the source of truth. |
| Seen/dismissed | `data/verdicts.json` | Your decisions survive re-scoring. |

Scores are derived, never stored as truth — so improving the scoring model
re-ranks your entire history instead of only affecting new listings.
