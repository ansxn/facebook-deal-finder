# Facebook Marketplace Deal Finder

A personal tool that browses Facebook Marketplace once a day for the items I'm
hunting, scores each listing against fair market value, and ranks everything it
finds by attractiveness — with the reasoning shown, and nothing auto-rejected.

Not a scraper. It drives **my own signed-in Chrome** through Claude in Chrome, at
human pace — a handful of searches once a day. See
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for why that constraint shapes the
whole design.

## Using it

There's no app to launch. You ask Claude to hunt; local code does everything else.

```bash
/hunt                 # run today's searches in your Chrome
/hunt golf            # just one search
/morning-hunt         # hunt if due, otherwise show standings
/hunt-update          # add or drop a search, or move your location
```

Then read the results — in the browser:

```bash
node scripts/serve.mjs        # → http://localhost:3000
```

or in the terminal:

```bash
node scripts/deals.mjs        # top 10 per search, ranked, flags in brackets
node scripts/deals.mjs --all  # every listing, including ones you passed on
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
| 6 | Daily trigger (`/morning-hunt`) | ✅ semi-manual by design |

## What the first live run taught

Phase 2 ate the time, as expected. The findings are baked into
[the browse skill](.claude/skills/hunt/SKILL.md), marked
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
.claude/skills/        /hunt, /morning-hunt, /hunt-update — routines, not code
scripts/               ingest, dedupe, scoring, server — plain Node, zero dependencies
dashboard/             localhost UI
data/                  listing store + my verdicts (gitignored)
docs/                  architecture, config reference, hosting notes
```

## Hosting

Dashboard is deployed to Vercel with a Supabase backend — setup and the security
decision: [docs/SETUP-HOSTING.md](docs/SETUP-HOSTING.md). The hunt stays local
permanently. Trade-offs: [docs/HOSTING.md](docs/HOSTING.md).

## Inviting a friend

Email them [START-HERE.md](START-HERE.md). They open Claude Code, point it at
the file, and it walks them through signing up, choosing what to hunt, and
their first run. Their searches and listings stay in their own account.

## Requirements

- Node (no npm dependencies — everything is stdlib)
- Chrome, signed in to Facebook
- Claude Code with Claude in Chrome connected
