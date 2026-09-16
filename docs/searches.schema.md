# `searches.json` field reference

The dashboard's Searches page is the normal way to change this file now:
sliders and toggles for the numbers, chips for search terms and dealbreakers,
a live "would be worth a look" preview, and one Save that re-ranks everything.
Editing by hand still works. Both paths stamp a top-level `updated_at`; the
newer copy wins when `scripts/pull-config.mjs` / `scripts/push.mjs` sync the
laptop and the hosted dashboard.

## `penalties` (per search, optional)

Each rule failure multiplies the score by a fixed factor (dealbreaker ×0.25,
missing hard must-have ×0.4, below min price ×0.4, over ceiling ×0.5, too far
×0.6, condition below floor ×0.7). `penalties` overrides any of those per
search, from `0.05` (near-fatal) to `1` (ignore the rule). This is the one
lever that changes verdicts on listings you have *already* seen — dealbreakers
and must-have wording only apply to listings assessed from the next hunt on.

## `global`

| Field | Meaning |
|---|---|
| `currency` | Declares what every amount in this file means. Currently `CAD`, because Marketplace resolves to Toronto and lists in CA$. No conversion happens anywhere — amounts are compared to listing prices as-is. |
| `location.mode` | `facebook_default` uses whatever your Marketplace is set to. `explicit` pins searches to `location.place` (a ZIP or "City, ST"). |
| `location.radius_miles` | Your intended pickup radius. Advisory — see `max_km`. |
| `max_km` | The radius that's actually enforced, locally. Facebook's own radius leaks badly (a 65 km setting returned listings 150 km out), so each listing gets an estimated `distance_km` during assessment and anything past this takes a `too_far` penalty (score ×0.6, flagged). |
| `surface_threshold_pct` | The "worth a look" line: % below fair value at which an unflagged listing counts as surfaced in headlines and the `deals.mjs` footer. It hides nothing — every listing is ranked. |
| `read_depth` | `full_detail` opens every listing's page. `two_stage` reads cards first and only opens promising ones. `cards_only` never opens listings. |
| `pacing.*` | Enforced by the browse skill, not advisory. Ranges like `[8, 25]` mean a random pause in that many seconds. |
| `pacing.abort_on_checkpoint` | Keep this `true`. Any CAPTCHA or "unusual activity" screen ends the run rather than working around it. |

## Per search

| Field | Meaning |
|---|---|
| `id` | Stable key. Listing dedupe and verdicts are stored against it — renaming it orphans your history. |
| `active` | `false` skips it without deleting the config. |
| `queries` | Search strings, run one at a time. More strings = more requests, so keep the list tight. |
| `filters` | Applied as Marketplace URL filters where supported, and re-checked locally because Marketplace's filters are unreliable. `filters.min_price` is scored locally: anything below it takes a `below_min_price` penalty (×0.4) — almost always a part, not the item. |

### `must_have` / `nice_to_have`

Each entry pairs a machine key with a plain-English `test` that the scoring step
evaluates against the listing text and photos.

- `must_have` with `"hard": true` — an explicit `false` takes a
  `missing_hard_must_have` penalty (×0.4 each) and is flagged. Nothing is
  hidden; it ranks near the bottom with the reason shown.
- `must_have` with `"hard": false` — failing it lowers the spec-match component
  instead. Use this where sellers commonly omit the detail (golf shaft flex is
  the classic case) so silence isn't treated as a "no".
- `nice_to_have.weight` — additive bonus, `0`–`1`, applied to the spec-match
  component of the score.

Writing `test` as an instruction rather than a keyword list is deliberate:
Marketplace titles are inconsistent enough that regex alone produces mostly false
negatives.

### `condition`

`floor` is the worst you'll accept; `accept` is the explicit allowlist — a
condition outside it takes a `condition_below_floor` penalty (×0.7). `note`
gets passed to the scorer as context for judgment calls. An assessor-marked
`disqualified: true` (something in `dealbreakers`) is the heaviest penalty of
all (×0.25) but still ranks rather than hides.

### `fair_value`

Three `method`s, one per category shape:

- `brand_tier` — one FMV per brand tier, then multiplied by `adjustments`. For
  categories where brand dominates price (golf).
- `per_set_lookup` — a default plus `set_overrides` for named editions. For
  categories where the specific edition is everything (Pokémon).
- `model_lookup` — explicit per-model new/used values, plus
  `unknown_model_fallback` for anything unlisted. For categories with
  identifiable model numbers (speakers).

`reference_condition` states what the configured numbers already describe —
normally `good`, meaning "a typical used example". Condition adjusts *relative to
that*. Without it the code would treat a tier value as pristine-and-current and
depreciate an already-depreciated number, which understated fair values badly
enough to hide real deals.

`confidence` is honest metadata: `seed` means estimated from asking prices, not
sold comps; `medium` means calibrated against live listings. `known_negatives`
records models already ruled out and why, so they never need re-investigating.

Adjustment multipliers stack but are floored at 0.65 combined — three
independent-looking penalties once multiplied out to 0.54 of book value, which
is below what the items actually sell for. Age thresholds must sit *above* the
category norm (`generation_10plus_years_old`, not `5plus`) or they fire on
nearly every listing and become a blanket markdown of the whole tier.

### `pricing`

| Field | Meaning |
|---|---|
| `max` | Your ceiling. Above it a listing takes an `over_ceiling` penalty (×0.5) and is flagged with how far over it is — still ranked, since a $20 overshoot is a negotiation, not a no. |
| `good_deal_pct` / `great_deal_pct` | % below fair value that earns each label. |

Amounts have no currency suffix on purpose. `global.currency` is the single
declaration; naming a field `max_usd` while it holds CAD is how a 35% error gets
shipped.
