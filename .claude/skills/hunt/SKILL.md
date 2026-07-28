---
name: hunt
description: Run the daily Facebook Marketplace hunt — opens the user's own signed-in Chrome, runs the configured searches at human pace, reads and assesses listings, and stores them for scoring. Use when the user says /hunt, hunt, run the deal finder, check Marketplace, or run today's searches. Accepts an optional search name (golf, pokemon, speakers) to run just one.
---

# Hunt Marketplace

You are doing the browsing yourself, in the user's real Chrome, because Facebook
blocks code from doing it. Everything downstream is plain local Node.

Everything below marked **(verified)** was confirmed against live Marketplace on
2026-07-27. Where Marketplace behaved differently from the obvious approach, the
note says so — those are the expensive lessons, don't re-learn them.

## Hard rules

1. **Use `mcp__claude-in-chrome__*`, never `mcp__Claude_Browser__*`.** Only the
   real Chrome has the logged-in Facebook session.
2. **Never bypass a checkpoint.** Any CAPTCHA, "unusual activity", "confirm it's
   you", or login wall → `node scripts/run.mjs abort "<what you saw>"`, tell the
   user, stop. Do not retry, reload, or route around it.
3. **Respect the run gate.** Start with `node scripts/run.mjs check`. Exit code 1
   means stop. Only `--force` if the user asks after being told it's too soon.
4. **Pace every step** using `searches.json` → `global.pacing`. Wait with
   `computer` action `wait` (a foreground `sleep` in Bash is blocked).
5. **Never message a seller, never click Buy, never save a payment method.**

## Steps

### 1. Gate and set up

```bash
node scripts/run.mjs check && node scripts/run.mjs start
```

Read `searches.json`. Note `global.currency` — **listings are in CAD** and every
fair-value number in the config is CAD too. Do not convert. (verified: the
account's Marketplace resolves to Toronto and prices in CA$.)

### 2. One search at a time

Sequential only. Never open several searches in parallel.

```
https://www.facebook.com/marketplace/search?query=<urlencoded>&minPrice=<n>&maxPrice=<n>&sortBy=creation_time_descend&exact=false
```

**(verified)** Facebook rewrites this to `/marketplace/<city>/search/?…` and
keeps your params. `minPrice`/`maxPrice` and `sortBy=creation_time_descend` both
work — every result came back in range and marked "Just listed".

**(verified, 2026-07-27) `sortBy=creation_time_descend` silently destroys query
relevance on brand and model searches. Drop it for those.** `query=kanto
speakers&sortBy=creation_time_descend` returned **zero Kanto listings** — just a
generic recency feed of the whole speaker category. The identical search with
`sortBy` removed returned 13 real Kanto listings, including the only speaker in
the entire run that met the user's requirements. The Kanto listings existed the
whole time; the sort buried them.

Rule of thumb: recency sort is fine for a broad category phrase ("complete golf
set", "pokemon elite trainer box"), where it worked correctly both runs. For any
query carrying a brand or model token, drop `sortBy` and let relevance rank. If a
brand query returns nothing of that brand, that is this bug, not an empty market
— re-run without the sort before concluding anything.

**(verified)** The location radius does **not** hold. The account is set to
"Within 65 km" and results still came from Niagara Falls, Norfolk and Waterloo —
100–150 km out. Distance must be filtered locally; see the assessment step.

### 3. Read the result cards — use `read_page`, not JavaScript

**(verified) `javascript_tool` is blocked on facebook.com.** Every attempt
returns `[BLOCKED: Cookie/query string data]`, including scripts that touch
neither cookies nor the query string. Do not waste a run rediscovering this.

Use `read_page` with `filter: "interactive"` instead. It is genuinely better —
one call returns title, price, location and listing id together:

```
link "Ping i3 O-Size Iron Set with Odyssey Putter and TaylorMade Bag, CA$350, Norfolk, ON, listing 1787416"
  href="/marketplace/item/1787416939121193/?ref=search&…"
```

Two things about that:

- **Take the id from the `href`, never from the label.** (verified) Labels are
  truncated mid-number — the example above shows `listing 1787416` for item
  `1787416939121193`. A truncated id breaks dedupe silently and permanently.
- `read_page` output is capped, so raise `max_chars` or page through it. About
  14 listings fit in 6000 chars.

`get_page_text` also works on the results page and is easier to skim, but it
returns **no ids and no links**, so it can't be the primary source. Use it as a
cross-check for how many results loaded.

**(known gap)** Neither tool exposes result-card image URLs, so listings
currently store no photo and the dashboard shows a placeholder. Everything else
works without it; don't block a run trying to solve this.

Scroll a few times to load more, pausing between scrolls. Stop at ~25–30 cards.

### 4. Open listing pages

`global.read_depth` controls this (`full_detail` / `two_stage` / `cards_only`).
Respect `pacing.max_listing_pages_per_run` across the whole run.

Navigate, wait a beat, then `get_page_text`. **(verified)** Detail pages give
everything worth having: full description, `Condition: Used - Good`, exact
posting time, and seller name + rating + join year.

**(verified) Stop reading at "Related searches" or "Today's picks".** Everything
after those headings is unrelated inventory Facebook injects — random couches,
cars, and other categories. Parsing it as results will poison the store.

Wait `pacing.seconds_between_listings` before the next one.

### 5. Assess against the user's actual criteria

Judge each listing against that search's `must_have`, `nice_to_have`,
`dealbreakers` and `condition`. Each rule has a plain-English `test` — follow it.

```json
{
  "brand": "Ping",
  "condition": "good",
  "distance_km": 150,
  "must_have":    { "right_handed": true, "full_iron_set": true, "driver": false },
  "nice_to_have": { "bag": true, "major_brand": true },
  "disqualified": false,
  "notes": "Irons + putter + bag only — no driver, so not a complete set.",
  "confidence": 0.95
}
```

Rules that matter, in order of how much damage getting them wrong does:

- **Brand means the brand of the item, not of an accessory.** (verified, and it
  produced a fake 48%-off "steal") A title like *"Complete RH Golf Clubs with
  Wilson Bag"* describes a **Wilson bag** and unbranded clubs. Attributing
  "Wilson" to the clubs promoted it a whole price tier and invented a discount
  that wasn't there. If only an accessory carries a brand, **leave `brand`
  unset.** Same trap: "Titleist headcover", "TaylorMade stand bag".
- **Always set `distance_km`**, estimated from the town name. Code cannot
  geocode a place name, and Facebook's radius filter leaks badly, so this is the
  only thing keeping a two-hour drive off the list. Toronto reference points:
  Markham/Richmond Hill/Vaughan/Mississauga ~25–30, Oakville ~35, Brampton ~40,
  Clarington ~60, Barrie ~90, Waterloo/Woolwich ~105–110, Thorold/Niagara Falls
  ~125–130, Norfolk ~150.
- **Use `true`/`false` only when the listing actually says so. Omit when
  unknown.** Missing scores as half credit, which is right; an explicit `false`
  on a hard must-have kills the listing outright. Never infer `false` from
  silence. (In practice most sets don't itemise driver or putter — that's an
  unknown, not a no.)
- Only set `disqualified: true` for something in `dealbreakers`. Being expensive
  is not a disqualifier — scoring handles price.
- `condition` ∈ `like_new`, `sealed`, `good`, `working`, `fair`, `untested`,
  `broken`.

**(verified) Expect most listings to be rejects, and expect that to be correct.**
The first golf run: 24 results → 15 captured → 4 plausible → 0 above threshold.
Left-handed, ladies' and junior sets alone were 7 of 15. A quiet day is a real
result, not a failure to find anything.

### 6. Store it

Write to `data/incoming/<search-id>-<YYYY-MM-DD>.json` as
`{ "search_id": "...", "listings": [...] }`, then:

```bash
node scripts/ingest.mjs data/incoming/<file>.json
node scripts/deals.mjs --search <search-id>
```

Dedupe is automatic on Marketplace listing id, and price changes are recorded.

### 7. Close out

```bash
node scripts/run.mjs finish --seen <n> --new <n> --searches <ids>
```

Summarize: what's new and worth looking at, what was rejected and why, and
**anything that fought back** — filters that didn't apply, selectors that
missed, results that looked location-wrong. That last part is the most valuable
thing in the summary. When Marketplace's markup shifts, update this file's
**(verified)** notes so the next run doesn't repeat the discovery.
