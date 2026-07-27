# Facebook Marketplace Deal Finder

A personal tool that browses Facebook Marketplace once a day for the items I'm
hunting, scores each listing against fair market value, and surfaces only the
genuinely good new ones.

Not a scraper. It drives **my own signed-in Chrome** through Claude in Chrome, at
human pace — a handful of searches once a day. See
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for why that constraint shapes the
whole design.

## Using it

There's no app to launch. You ask Claude to hunt; local code does everything else.

```bash
/hunt                 # run today's searches in your Chrome
/hunt golf            # just one search
/morning              # hunt if due, otherwise show standings
```

Then read the results — in the browser:

```bash
node scripts/serve.mjs        # → http://localhost:3000
```

or in the terminal:

```bash
node scripts/deals.mjs        # ranked deals above threshold
node scripts/deals.mjs --all  # everything, including rejects and why
node scripts/run.mjs status   # when the last run happened
```

Only `/hunt` needs Chrome. Everything else works offline against stored data.

## Status: v1 complete

| Phase | What | State |
|---|---|---|
| 1 | Intake → editable `searches.json` | ✅ |
| 2 | Browse routine, golf end to end | ✅ verified live |
| 3 | Valuation & deal scoring | ✅ |
| 4 | All three searches + dedupe | ✅ golf run live; other two configured, not yet run |
| 5 | Dashboard | ✅ |
| 6 | Daily trigger (`/morning`) | ✅ semi-manual by design |

## What the first live run taught

Phase 2 ate the time, as expected. The findings are baked into
[the browse skill](.claude/skills/browse-marketplace/SKILL.md), marked
**(verified)** so they don't get rediscovered:

- **`javascript_tool` is blocked on facebook.com.** DOM extraction is impossible;
  `read_page` is the way, and it turns out to be better anyway — title, price,
  location and listing id in one call.
- **Listing ids in accessibility labels are truncated.** Take them from the
  `href` or dedupe breaks silently.
- **The location radius leaks.** A 65 km setting returned listings 150 km out, so
  distance is estimated per listing and enforced locally.
- **Prices are CAD.** The account resolves to Toronto. USD anchors would have
  made every listing look ~35% underpriced.
- **Brand must come from the item, not an accessory.** "Complete RH Golf Clubs
  with Wilson Bag" is unbranded clubs and a Wilson bag — reading that as a Wilson
  set invented a 48%-off "steal" out of a fairly priced listing.

Scoring bugs the fixture caught before going live: condition was double-counted
(once in fair value, once in the score), and adjustment multipliers compounded
a Callaway set down to $258 when those sell for well over $300.

## Layout

```
searches.json          what I'm hunting — hand-editable, also written by the dashboard
.claude/skills/        the browse routine (a Claude skill, not code)
.claude/commands/      /hunt and /morning
scripts/               ingest, dedupe, scoring, server — plain Node, zero dependencies
dashboard/             localhost UI
data/                  listing store + my verdicts (gitignored)
docs/                  architecture, config reference, hosting notes
```

## Hosting

Runs locally by default. The dashboard *can* go on Vercel, but the hunt never
can — and hosting makes the "Run now" button worse, not better. Trade-offs and
the migration seam: [docs/HOSTING.md](docs/HOSTING.md).

## Requirements

- Node (no npm dependencies — everything is stdlib)
- Chrome, signed in to Facebook
- Claude Code with Claude in Chrome connected
