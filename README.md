# Facebook Marketplace Deal Finder

Browses Facebook Marketplace once a day for the things I'm hunting, estimates
what each listing is actually worth, and ranks everything by how good a deal it
is — with the reasoning shown, and nothing auto-rejected.

Not a scraper. It drives **my own signed-in Chrome** through Claude in Chrome, at
human pace, a handful of searches a day. That one constraint shapes the whole
design: see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## The split

Facebook blocks automated browsing, so the browsing has to happen in a real
signed-in browser at human speed. Nothing else does.

So the browsing is an agent skill running against the user's Chrome, and
everything downstream — dedupe, valuation, scoring, ranking — is a hosted API.
A hunt is three HTTP calls: open the run, send each search's findings, close the
run. There is no local database, no sync step to forget, and installing it takes
two commands.

Scores are never stored. They're recomputed from the stored assessment every
time the board is read, so moving a slider on the website re-ranks six weeks of
history instantly, and improving the scoring improves every listing ever seen.

## Using it

```
/deal-finder:hunt          run today's searches in your Chrome
/deal-finder:morning-hunt  hunt if due, otherwise show what's standing
/deal-finder:hunt-update   add or drop a search, or move city
/deal-finder:setup         first-time setup
```

Results live at [deal-finder-zeta.vercel.app](https://deal-finder-zeta.vercel.app).
Budgets, thresholds and dealbreakers are sliders there; changing one re-ranks
immediately.

## Installing

```
/plugin marketplace add ansxn/facebook-deal-finder
/plugin install deal-finder@deal-finder
```

Requires Chrome signed in to Facebook, and Claude Code with Claude in Chrome
connected. That's the whole list. Full walkthrough: [START-HERE.md](START-HERE.md).

## What the first live runs taught

Phase 2 ate the time, as expected. The findings are baked into
[the hunt skill](plugins/deal-finder/skills/hunt/SKILL.md), marked **(verified)**
so they don't get rediscovered:

- **`javascript_tool` is blocked on facebook.com.** DOM extraction is impossible;
  `read_page` is the way, and it turns out to be better anyway — title, price,
  location and listing id in one call.
- **Listing ids in accessibility labels are truncated.** Take them from the
  `href` or dedupe breaks silently.
- **`sortBy=creation_time_descend` destroys query relevance.** `kanto speakers`
  with the recency sort returned zero Kanto listings — a generic speaker feed.
  Without it, 13 real ones, including the only speaker in the run that met the
  requirements. The listings existed the whole time; the sort buried them.
- **The card price is frequently not the price of the titled item.** A listing
  advertising a premium Pokémon-Center ETB at CA$90 was selling a $90 booster
  bundle; the ETB was $400. Scoring the card price against the titled item
  manufactures spectacular deals that don't exist.
- **The location radius leaks.** A 65 km setting returned listings 150 km out, so
  distance is estimated per listing and enforced locally.
- **Brand must come from the item, not an accessory.** "Complete RH Golf Clubs
  with Wilson Bag" is unbranded clubs and a Wilson bag — reading that as a Wilson
  set invented a 48%-off "steal" out of a fairly priced listing.

Scoring bugs the fixtures caught before going live: condition was double-counted
(once in fair value, once in the score), and adjustment multipliers compounded a
Callaway set down to $258 when those sell for well over $300.

And one that reached production before it was caught: on a re-ingest, the
"later passes carry richer data" merge loop copied every raw field back over the
parsed price, so `"CA$325"` overwrote `325` and nine listings scored as `NaN` on
the live board. The merge now handles price, price history and the assessment
explicitly instead of letting them fall through a generic loop.

## Layout

```
plugins/deal-finder/    the skills, shipped as a Claude Code plugin
web/api/                the hosted API — ingest, run gate, scoring, auth
web/api/_lib/           scoring, fair value, merge rules, Supabase access
web/index.html          the dashboard
supabase/migrations/    schema
scripts/admin/          owner-only break-glass tooling
docs/                   architecture, config reference, hosting notes
```

Zero dependencies anywhere — no npm install, in the API or out of it. The
Supabase client is plain `fetch` against PostgREST.

## Hosting

Vercel plus Supabase, deployed from git with no build step. Setup and the
security decisions: [docs/SETUP-HOSTING.md](docs/SETUP-HOSTING.md). Trade-offs
considered: [docs/HOSTING.md](docs/HOSTING.md).

Each person has their own account; searches, listings and verdicts are scoped
per user. The hunt authenticates with a push token, the dashboard with a session
cookie, and the two share endpoints.
