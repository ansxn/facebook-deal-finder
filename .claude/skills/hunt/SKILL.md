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

**(verified, 2026-07-29) The bug is wider than "brand and model searches" —
`pokemon elite trainer box` broke too. Default to dropping `sortBy` on every
search.** With the recency sort, that query returned 24 results containing
exactly **one** ETB — the rest was a generic recent-Pokémon feed of booster
bundles, single cards, promos, a playmat, and two items that were not Pokémon at
all. The identical search with `sortBy` removed returned 15 results, nearly all
genuine ETBs, including every listing that mattered. This contradicts the earlier
note that the phrase "worked correctly both runs"; treat that as superseded.

Rule of thumb, revised: **drop `sortBy` by default.** Relevance ranking has now
been the better source on every query it has been tested against, and "Just
listed" badges plus the `Date listed` facet still let you see recency without
sorting by it. Only reach for `creation_time_descend` if you specifically need
the newest listings and the query is a broad category phrase — and re-check the
first few results are actually on-topic before trusting the page. If a query
returns nothing of the thing you searched for, that is this bug, not an empty
market — re-run without the sort before concluding anything.

One side effect worth knowing: without the recency sort you get old listings
back. This run surfaced a year-old ETB and a 19-week-old speaker pair. That is
usually fine (a stale listing with a price drop is a motivated seller) but check
the "Listed X ago" line before treating anything as new.

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
- **(verified) The results list is virtualized — cards leave the accessibility
  tree once you scroll past them.** `read_page` returns only what is near the
  viewport, so a single read after scrolling to the bottom silently loses
  everything above it. Read after *each* scroll and accumulate, rather than
  scrolling to the end and reading once. If you notice a gap between two reads
  (ref numbers jump), `find` with the card's title text recovers the missing
  href without re-scrolling.

`get_page_text` also works on the results page and is easier to skim, but it
returns **no ids and no links**, so it can't be the primary source. Use it as a
cross-check for how many results loaded.

**(settled 2026-09-15)** Neither tool exposes result-card image URLs, and
Facebook's CDN links expire anyway, so listings store no photos and the
dashboard has no photo slot. Don't spend run time trying to capture images.

Scroll a few times to load more, pausing between scrolls. Stop at ~25–30 cards.

### 4. Open listing pages

`global.read_depth` controls this (`full_detail` / `two_stage` / `cards_only`).
Respect `pacing.max_listing_pages_per_run` across the whole run.

Navigate, wait a beat, then `get_page_text`. **(verified)** Detail pages give
everything worth having: full description, `Condition: Used - Good`, exact
posting time, and seller name + rating + join year.

**(verified) Stop reading at "Related searches" or "Today's picks".** Everything
after those headings is unrelated inventory Facebook injects — random couches,
cars, and other categories. Parsing it as results will poison the store. (It is
worse than random: those blocks are ad-targeted from *your own* searches, so
after a golf run they fill with golf sets and after a speaker run with Kanto
speakers. They look exactly like results for the search you are on. Never harvest
a listing from them — go find it through a real search.)

**(verified, 2026-07-27) The card price is frequently NOT the price of the titled
item.** This is the single highest-damage trap found so far, and it was in four
of six Pokémon listings opened in one run:

| Card said | Description actually said |
|---|---|
| "Pokemon ETB **Lot**" — CA$90 | "90 each" for 6 boxes |
| "Pitch Black ETB" — CA$100 | "$100 each", multi-quantity |
| "Chaos rising booster box and etb" — CA$110 | CA$110 is the ETB; boxes are $270–285 |
| "30th anniversary **pokemon center etb**" — CA$90 | **PC ETB is $400**; the $90 item is a booster bundle |

That last one is the shape to fear: the card advertises a premium
Pokémon-Center-exclusive ETB at CA$90, and scoring that against a
Pokémon-Center-premium fair value manufactures a spectacular deal that does not
exist. Facebook's price field shows the listing's *cheapest* item, and sellers
title the listing after the *most desirable* one.

**(verified again, 2026-07-29 — three more, including a near-exact repeat.)** Do
not treat the table above as a historical curiosity; this is the steady state of
the Pokémon category.

| Card said | Description actually said |
|---|---|
| "Pitch Black **Pokémon Center ETB**, Booster box, Booster Bundle" — CA$45 | booster bundle $45 · **PC ETB $170** · booster box $260 |
| "Elite Trainer Box**es** (Prismatic, Chaos Rising, **Evolving Skies**)" — CA$90 | CA$90 buys one Chaos Rising · **Evolving Skies is $820** · Prismatic $195 |
| "Pitch Black Elite Trainer Box **and** Booster Bundle" — CA$96 | bundle $50 · **ETB $140** · box $240 — CA$96 matches *nothing* |

Three additions to the rule from these:

- The Pokémon-Center repeat is the same trap as 2026-07-27, same premium variant,
  different set. Scoring CA$45 as a PC ETB, or CA$90 against Evolving Skies'
  CA$410, would each have produced the run's "best deal" out of thin air.
- **The card price is not always even the cheapest item — sometimes it is no item
  at all.** CA$96 corresponded to none of that listing's three prices. When the
  card price matches nothing, disqualify with the real price in the reason rather
  than leaving a fictional number in the store.
- The card can render a strikethrough pair like "CA$45 CA$200", which reads as a
  markdown on the whole bundle when it is really the price of the cheapest single
  item next to an unrelated former price. Do not read it as a discount.

**(verified, 2026-07-29) Facebook's structured detail fields are seller-populated
and are wrong often enough to distrust.** Two independent cases in one run:

- `Brand: Slazenger` on a golf set whose clubs were all Alien Golf, Rawlings and
  AltaPro — Slazenger was the **bag**. The platform's own Brand field inherits the
  accessory-brand trap.
- `Condition: New` on an ETB whose description said the packaging was removed and
  the card packs opened.

`Hand Orientation` has been reliable so far and is genuinely useful — it is the
fastest way to settle handedness. But **never let a detail field override the
description.** Where they conflict, the description wins.

So: **never score a multi-item or plural-sounding listing from the card alone.**
Anything whose title contains "lot", "and", "bundle", a plural, or several named
products must have its detail page opened before it is stored. If the price turns
out to belong to a different item than the title, record the listing against what
the price actually buys — usually that means failing a `must_have` and a
`disqualify_reason`, not a bargain.

Golf listings do not do this nearly as much, but they have their own version:
sets advertised at a single price where the description reveals a per-club or
per-item breakdown. Same rule applies.

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
- **(2026-07-29) Two further shapes of the same trap, both seen live:**
  - *The brand covers some clubs but not the ones that matter.* "Men's RH Complete
    Golf Club Set Graphite Irons **Wilson** Driver Top Flite Stand Bag **Jazz**" —
    Wilson is real, but it is only the driver and putter; the irons, wedge, wood
    and utility are all Jazz, and the bag is Top Flite. The irons define a set, so
    `brand` stays unset. A brand naming two of eleven clubs does not tier the set.
  - *The brand is in a comparison, not the product.* A listing whose irons were
    Powermax said they "play like the **Callaway** X22 irons". That is the seller's
    performance claim. Never promote a tier on a simile.
- **A vague title is not evidence of a thin listing — open it anyway.**
  (2026-07-29) The most complete set of the run was titled "Men's Golf clubs." and
  its description itemised fourteen clubs, shaft flex, fresh Golf Pride grips and a
  Sun Mountain cart bag. Meanwhile the loudest, most brand-stuffed titles were the
  keyword-spam ones. Title length correlates with nothing.
- **Always set `distance_km`**, estimated from the town name. Code cannot
  geocode a place name, and Facebook's radius filter leaks badly, so this is the
  only thing keeping a two-hour drive off the list. Toronto reference points:
  Markham/Richmond Hill/Vaughan/Mississauga ~25–30, Oakville ~35, Brampton ~40,
  Clarington ~60, Barrie ~90, Waterloo/Woolwich ~105–110, Thorold/Niagara Falls
  ~125–130, Norfolk ~150. Added 2026-07-29: Ajax ~40, Newmarket ~45, Whitby ~50,
  East Gwillimbury/Caledon ~55, Burlington ~55, Hamilton ~70, Grimsby/Shelburne
  ~85, Cambridge ~95, Brantford ~100, Pelham ~110, Springwater ~110,
  Peterborough ~125, Kawartha Lakes ~150.
- **Use `true`/`false` only when the listing actually says so. Omit when
  unknown.** Missing scores as half credit, which is right; an explicit `false`
  on a hard must-have kills the listing outright. Never infer `false` from
  silence. (In practice most sets don't itemise driver or putter — that's an
  unknown, not a no.)
- Only set `disqualified: true` for something in `dealbreakers`. Being expensive
  is not a disqualifier — scoring handles price.
- `condition` ∈ `like_new`, `sealed`, `good`, `working`, `fair`, `untested`,
  `broken`.

**(verified, 2026-07-27) An empty listing scores as a top deal. Distrust the
ranking when `notes` say there was nothing to read.** The highest-scoring result
of the second run — "50% under" — was a listing whose entire description was
"Cash and pick up only". Unknown must-haves score as half credit and an unknown
brand falls to the entry tier, so a listing with *no information at all* collects
partial credit everywhere and gets marked down against a floor value. Three of
these, from one seller who posted four descriptionless golf listings in an hour,
took the top three slots.

This is a scoring weakness, not a Marketplace one, so it cannot be fixed by
browsing more carefully. What browsing *can* do is set `confidence` honestly
(0.3–0.4 for a listing with no description) and say plainly in `notes` that
nothing was verifiable. Then call it out in the summary rather than presenting it
as the day's best find.

**(2026-07-29) Those same three listings still hold the top three golf slots**,
two runs later, because dedupe keeps them in the store and nothing has out-scored
them. Expect them at the top of every golf run until either the config gains a
minimum-information rule or the listings expire. Say so in the summary each time
rather than re-explaining them as new. The first genuinely-earned entry on the
board is whatever sits below them.

**(2026-07-29) Recording an honest `years_old` can push a real find below the
threshold — that is working correctly, but flag it.** A Titleist set (909D2
driver, DCI irons, complete, RH-confirmed, CA$279) landed at ~17% under after the
`generation_10plus_years_old` 0.8 multiplier — just under the 20% surface bar.
Omitting the age would have shown it as 33% under and second on the board. The
adjustment is right; late-2000s clubs are not worth a current major-brand FMV. But
a listing that misses the bar *because* you documented it well deserves a mention
in the summary, or the care is invisible.

**(verified) Expect most listings to rank low, and expect that to be correct.**
The first golf run: 24 results → 15 captured → 4 plausible → 0 worth a look.
Left-handed, ladies' and junior sets alone were 7 of 15. A quiet day is a real
result, not a failure to find anything.

**Nothing is auto-rejected.** Scoring never hides a listing: a dealbreaker,
a price over the ceiling, a missing hard must-have or a too-far distance is a
*penalty with a reason*, shown as a flag on the ranking. So keep recording
`disqualified: true` and honest `false`s exactly as before — they push a
listing to the bottom with its reason attached, which is what the user wants
to see. Only the user's own Pass removes something.

### 6. Store it

Write to `data/incoming/<search-id>-<YYYY-MM-DD>.json` as
`{ "search_id": "...", "listings": [...] }`, then:

```bash
node scripts/ingest.mjs data/incoming/<file>.json
node scripts/deals.mjs --search <search-id>
```

Dedupe is automatic on Marketplace listing id, and price changes are recorded.

**(verified, 2026-09-15) Resubmitting an already-stored listing through ingest
stores the price as the raw string (`"CA$325"`), which turns its score into
`NaN` in deals.mjs.** The new-listing path parses the currency prefix; the
update path does not. Until ingest is fixed, pass a bare number in `price` for
any listing you know is already in the store — or skip resubmitting repeats
entirely unless the price changed.

## Mechanics learned 2026-09-15

- **The Chrome extension disconnects mid-run routinely** (service-worker
  restarts). It reconnects on retry within a few seconds. A `browser_batch`
  that dies mid-way may have completed its navigate — check `tabs_context_mcp`
  for where the tab actually is before re-navigating, or you double-visit.
- **`computer` `wait` rejects durations over 10 s** and the failure kills the
  rest of the batch. Chain multiple 10 s waits for between-search pacing.
- **A Messenger chat popup can open over the results page** and flood
  `read_page` with the user's private conversation. Close it via its "Close
  chat" button, ignore its contents entirely, and re-read.
- **Video-first listings return "No text content found"** from `get_page_text`
  while the player has focus. A screenshot still shows the details panel; read
  it from there (or retry after a beat).
- **(2026-09-15) `kanto speakers` returned a genuine "No listings found within
  65 kilometers" empty state** — a real empty page with an illustration, not
  the sortBy relevance bug (no sort was applied). Distinguish the two before
  re-running: the bug shows off-topic results; the empty state shows none.

### 7. Close out

```bash
node scripts/run.mjs finish --seen <n> --new <n> --searches <ids>
```

Summarize: the top few listings by attractiveness (new ones first, with their
flags — `deals.mjs` prints the flags in brackets), anything that ranked low for
a reason worth a human glance, and **anything that fought back** — filters that didn't apply, selectors that
missed, results that looked location-wrong. That last part is the most valuable
thing in the summary. When Marketplace's markup shifts, update this file's
**(verified)** notes so the next run doesn't repeat the discovery.
