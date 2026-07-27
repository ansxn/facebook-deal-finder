# `searches.json` field reference

Edit this file by hand any time. The dashboard (Phase 5) writes the same shape.

## `global`

| Field | Meaning |
|---|---|
| `location.mode` | `facebook_default` uses whatever your Marketplace is set to. `explicit` pins searches to `location.place` (a ZIP or "City, ST"). |
| `location.radius_miles` | Pickup radius applied to every search. |
| `surface_threshold_pct` | Minimum % below fair value for a listing to appear in the digest at all. Below this, it's stored but not surfaced. |
| `read_depth` | `full_detail` opens every listing's page. `two_stage` reads cards first and only opens promising ones. `cards_only` never opens listings. |
| `pacing.*` | Enforced by the browse skill, not advisory. Ranges like `[8, 25]` mean a random pause in that many seconds. |
| `pacing.abort_on_checkpoint` | Keep this `true`. Any CAPTCHA or "unusual activity" screen ends the run rather than working around it. |

## Per search

| Field | Meaning |
|---|---|
| `id` | Stable key. Listing dedupe and verdicts are stored against it — renaming it orphans your history. |
| `active` | `false` skips it without deleting the config. |
| `queries` | Search strings, run one at a time. More strings = more requests, so keep the list tight. |
| `filters` | Applied as Marketplace URL filters where supported, and re-checked locally because Marketplace's filters are unreliable. |

### `must_have` / `nice_to_have`

Each entry pairs a machine key with a plain-English `test` that the scoring step
evaluates against the listing text and photos.

- `must_have` with `"hard": true` — failing it disqualifies the listing outright.
- `must_have` with `"hard": false` — failing it is a heavy score penalty, not a
  rejection. Use this where sellers commonly omit the detail (golf shaft flex is
  the classic case) so silence isn't treated as a "no".
- `nice_to_have.weight` — additive bonus, `0`–`1`, applied to the spec-match
  component of the score.

Writing `test` as an instruction rather than a keyword list is deliberate:
Marketplace titles are inconsistent enough that regex alone produces mostly false
negatives.

### `condition`

`floor` is the worst you'll accept; `accept` is the explicit allowlist. `note`
gets passed to the scorer as context for judgment calls.

### `fair_value`

Three `method`s, one per category shape:

- `brand_tier` — one FMV per brand tier, then multiplied by `adjustments`. For
  categories where brand dominates price (golf).
- `per_set_lookup` — a default plus `set_overrides` for named editions. For
  categories where the specific edition is everything (Pokémon).
- `model_lookup` — explicit per-model new/used values, plus
  `unknown_model_fallback` for anything unlisted. For categories with
  identifiable model numbers (speakers).

`confidence` is honest metadata: `seed` means I estimated it from asking prices,
not sold comps. Phase 3 replaces these with real comps and raises the confidence.
`known_negatives` records models already ruled out and why, so they never need
re-investigating.

### `pricing`

| Field | Meaning |
|---|---|
| `target_usd` | What you'd be happy paying. Used as the score's midpoint. |
| `max_usd` | Hard ceiling — above this, nothing surfaces regardless of value. |
| `good_deal_pct` / `great_deal_pct` | % below fair value that earns each label. |
