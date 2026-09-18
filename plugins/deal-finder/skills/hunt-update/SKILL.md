---
name: hunt-update
description: Change what the deal finder hunts — retire or delete searches, add new ones, and move the location. Use when the user says /hunt-update, wants to change what they are looking for, add or drop a search, hunt something different, or change their city or travel radius. Not for tuning thresholds, ceilings and dealbreakers, which are sliders on the website.
---

# Update the hunt

A guided edit of the searches config: what gets hunted, and where from.

Thresholds, ceilings, dealbreakers, must-haves and penalties are all sliders and
chips on the website's Searches page, with a live preview of what would surface.
If that is all they want, send them there and stop. This skill is for the three
changes the site has no button for: dropping a search, adding a new one, and
moving the location.

**Do not browse Marketplace here.** No hunting happens in this skill. Offer
`/deal-finder:hunt` at the end if they want to fill a new search; it has its own
gate.

## Steps

### 1. Read what they have

```bash
. ~/.deal-finder/df.sh
df GET /api/searches
df GET '/api/deals?view=compact&top=5'
```

There is one copy of the config and it lives on the website, so there is nothing
to reconcile — what you fetch is what the last edit left, wherever it was made.
Hold it in this conversation and edit it here; nothing is written to disk.

### 2. Show them what they have

Lay it out in plain words, one line per search: its name, whether it is active,
its search terms, its ceiling, and how many listings it has collected. Finish
with one line for location: the city in `global.location.resolved` and the
`global.max_km` radius.

Never show them JSON. They are picking from a menu, not editing a file.

### 3. Ask what changes

One question at a time, in this order:

1. Anything you want to stop hunting?
2. Anything you want to add?
3. Has your location changed?

Skip whichever they say no to. Most runs of this skill are one of the three.

### 4. Stopping a search: retire, don't delete

Two different things, and the difference is six weeks of price history.

- **Retire** (`active: false`) — the hunt skips it and it stops collecting, but
  the listings it already found stay on the board with their scores and
  verdicts. Reversible any time with the Active toggle on the website.
- **Delete** (remove the block) — its listings vanish from the ranking at once,
  because scoring skips any listing whose `search_id` has no config. They are
  not erased from the database, so adding a search back with the same `id`
  brings them all back, verdicts included.

**Retire unless they say they want it gone.** Offer delete only when they are
sure they will never hunt that thing again.

Never change an `id` to rename something. `id` is the dedupe and verdict key, so
renaming it orphans the history exactly like a delete does. The name shown on
the board is `label`, and that is free to change.

### 5. Adding a search: interview, then research

The config you already fetched shows the shape. Ask these one at a time,
offering examples when they hesitate:

1. What are you looking for, as specifically as you can say it?
2. What would a seller call it in a title? Suggest two to four search terms and
   let them edit the list. (`queries`)
3. Most you would pay? (`pricing.max`) Below what price is it probably a part or
   a scam? (`filters.min_price`)
4. What must it have? For each, ask whether a listing that stays silent about it
   should be a maybe (soft) or only ruled out when the seller confirms it is
   missing (hard). Write each as a plain sentence the assessor can check.
   (`must_have`, with `hard` true or false)
5. What would be nice but not required, and how much does each matter? Map that
   to a weight from 0.1 to 0.6. (`nice_to_have`)
6. What is an instant no? (`dealbreakers`, short phrases)
7. Which conditions are fine: sealed, like new, good, working, fair, untested,
   broken? (`condition.accept`; `condition.floor` is the worst one they accept)
8. What makes one worth more than another: the brand, the exact edition, or the
   exact model? That picks the valuation method.

Then write the block. `id` is a short lowercase slug with dashes. Defaults that
work: `good_deal_pct` 20, `great_deal_pct` 35. `title_style` says how listings
from this search get named on the board: brand and model first, then the two or
three facts its rules care about. Leave `global.pacing`, `read_depth` and
`surface_threshold_pct` exactly as they are.

**Fair value is the slow part and the whole game** — it decides whether anything
ever looks like a deal. Tell them it will take a few minutes, then actually do
the research: search the web for typical used prices of this item in their
currency and region. Never invent the numbers. Pick one method:

- `brand_tier` when brand drives price: a few tiers, each with `brands` and a
  used `fmv`, always including one tier named `entry` for unbranded listings.
- `per_set_lookup` when the edition drives price: `default_in_print_fmv` plus
  `set_overrides` for the editions worth more.
- `model_lookup` when the exact model drives price: `models` with `model`,
  `new_price` and `used_fmv`, plus `unknown_model_fallback` with
  `fmv_pct_of_new_retail` around 0.55.

**Adjustment keys are not free text.** The scorer recognises exactly three
shapes:
`missing_nice_to_have_<spec>` (fires when that nice-to-have is explicitly
false), `generation_<N>plus_years_old` (fires on `assessment.years_old`, and N
must sit above the category norm or it marks down the whole tier), and
`sealed_but_damaged_box`. Any other key is silently dead config that looks like
it works. If a value driver doesn't fit one of those shapes, leave it to
`must_have` and `nice_to_have` instead of inventing a key.

Set `reference_condition` to `good`: the numbers describe a typical used
example, not a pristine one. Get that wrong and the scorer depreciates an
already-depreciated number and hides real deals. Set `confidence` to `seed`
until it has been checked against live listings, and write a one-sentence
`basis` saying where the numbers came from.

### 6. Moving the location

Three parts, and only one of them is a control on the website.

1. **Facebook's own Marketplace location.** They change this themselves, in
   Chrome, on the Marketplace location filter. The hunt URL carries no location
   parameter: Facebook rewrites it to `/marketplace/<city>/search/` from the
   account setting. Nothing here can move it. Ask them to do it and confirm it
   is done before you go on.
2. **`global.location.resolved`.** The origin every `distance_km` is measured
   from. Set it to the new city. If it disagrees with what Facebook is serving,
   every distance estimate is wrong and `too_far` fires on the wrong listings.
3. **`global.max_km`.** How far they will actually travel. This is the radius
   that is enforced, locally, because Facebook's own radius leaks badly.

`global.location.mode`, `location.place` and `location.radius_miles` are written
by the website but read by nothing. Don't spend their time on those fields and
don't imply they do something.

**Then rewrite the distance table**, in `global.location.reference_distances`:
a map of town names to their distance in km. The assessor cannot geocode a town
name and estimates every `distance_km` from that map, so a table built for the
old city is worse than none. Research 12 to 20 towns and suburbs around the new
city, from about 20 km out to past their `max_km`, and write real distances
rather than guesses. Tell them you are doing it: this is the step that keeps the
radius real, and skipping it quietly breaks distance for every future hunt.

```json
"location": {
  "resolved": "London, Ontario",
  "reference_distances": { "St. Thomas": 30, "Woodstock": 50, "Toronto": 190 }
}
```

### 7. Confirm, check, push

Show a plain summary of every change — what is retired, what is new, where they
are hunting from — and ask whether anything is off. Fix it before writing.

Write the edited config to a temp file and check it before saving:

```bash
. ~/.deal-finder/df.sh
df PUT '/api/searches?dry_run=1' --data-binary @"${TMPDIR:-/tmp}/searches.json"
```

`dry_run` validates and scores the proposed config against everything already
stored, without saving. Fix every entry in `problems` and repeat until it
returns `HTTP 200`. Entries in `notes` are advisory: mention them, don't block.

The reply also carries `by_search` surface and total counts, so tell them what
the change does before committing it — "this takes you from 4 worth-a-look to
11" is worth more than a list of fields. Then save:

```bash
. ~/.deal-finder/df.sh
df PUT /api/searches --data-binary @"${TMPDIR:-/tmp}/searches.json"
```

### 8. Say when each change takes effect

- A retired or deleted search changes the board immediately.
- A new search collects nothing until the next `/hunt`.
- Ceilings, thresholds, penalties and distance re-rank what is already stored
  the moment the config is saved — scoring happens when the board is read, so
  the next page load already reflects it.
- Search terms, must-haves, dealbreakers, title style and condition notes are
  read by the assessor while it browses, so they only apply to listings assessed
  from the next hunt on. Nothing already on the board is re-judged by them.

Offer `/deal-finder:hunt` if they want to fill a new search now, but don't
start one without being asked.
