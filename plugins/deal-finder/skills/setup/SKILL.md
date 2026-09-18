---
name: setup
description: First-time setup for Deal Finder — connects the account, interviews the user about what they want to hunt, researches fair prices, and saves their searches. Use when the user says /setup, sets up the deal finder for the first time, or has just installed the plugin and has nothing configured yet.
---

# Set up Deal Finder

You are onboarding someone who is probably not a developer. Keep messages short,
ask one question at a time, use plain words, and do the technical work yourself.

**Never ask for, see, or type their password.** They create their account on the
website themselves. The only secret you handle is the push token they paste to
you, and it goes in `~/.deal-finder/env` and nowhere else.

**Do not browse Marketplace during setup.** Offer the first hunt at the end and
let the `hunt` skill do it.

## 1. Check the browser

Claude in Chrome must be connected: look for tools whose names contain
`claude-in-chrome` (search your deferred tools if needed). If they are missing,
tell them to install the extension from https://claude.com/chrome, sign in,
connect it to Claude Code, and restart this session. Stop until it is connected.

Then ask them to confirm Chrome is signed in to Facebook and that
https://www.facebook.com/marketplace opens for them.

Nothing else needs installing. No Node, no repository, no project folder.

## 2. Create their account

Ask them to open https://deal-finder-zeta.vercel.app, choose **Create an
account**, and sign up with their email and a password of at least 10
characters. If it asks for an invite code, they get it from whoever sent them
here.

Right after signup the site shows a **push token** once. Ask them to copy it and
paste it to you. It starts with `dfp_`.

## 3. Save the token

Write it yourself, then make the file private:

```bash
mkdir -p ~/.deal-finder
cat > ~/.deal-finder/env <<'ENVEOF'
DEALFINDER_PUSH_TOKEN=<paste the token here>
ENVEOF
chmod 600 ~/.deal-finder/env
```

Then write the helper every other skill uses. Copy this exactly:

```bash
cat > ~/.deal-finder/df.sh <<'SHEOF'
# Sourced by the Deal Finder skills before each API call. Keeps the token out
# of command text: it is read from the env file into the process, never typed.
if [ ! -r "$HOME/.deal-finder/env" ]; then
  echo "no ~/.deal-finder/env — run /deal-finder:setup" >&2
  return 1 2>/dev/null || exit 1
fi
set -a; . "$HOME/.deal-finder/env"; set +a
: "${DEALFINDER_API_URL:=https://deal-finder-zeta.vercel.app}"
df() {
  _m="$1"; _p="$2"; shift 2
  curl -sS --fail-with-body -X "$_m" \
    -H "authorization: Bearer $DEALFINDER_PUSH_TOKEN" \
    -H 'content-type: application/json' \
    -w '\nHTTP %{http_code}\n' \
    "$DEALFINDER_API_URL$_p" "$@"
}
SHEOF
chmod 600 ~/.deal-finder/df.sh
```

Check it works:

```bash
. ~/.deal-finder/df.sh
df GET /api/searches
```

`{"error":"no config pushed yet"}` with `HTTP 200` is exactly right — the token
works and there is nothing configured yet. `HTTP 401` means the token was copied
wrong: ask them to use **Account > Regenerate** on the site and paste the new
one. HTML instead of JSON means Vercel Deployment Protection is on for the
deployment; whoever runs the instance has to turn it off.

## 4. Explain the flow

Briefly, in your own words:

1. You tell me what you are looking for, your budget, and what is a dealbreaker.
   I turn that into your searches.
2. Once a day you type `/deal-finder:hunt`. It uses your Chrome, slowly, like a
   person would, for about 15 to 40 minutes. Keep Chrome open while it runs.
3. Each listing gets a fair price estimate, a score, and a clear name, even when
   the seller's title is a mess.
4. Results appear on the website, best deals first, with the reasons shown. Save
   the ones you like, pass on the rest, and open the listing to message the
   seller yourself.
5. You can change budgets, dealbreakers and search terms on the website any
   time. The next hunt follows them.

Ask if they have questions before continuing.

## 5. Interview them

Start with at most three searches. Ask conversationally, one question at a time,
and offer examples when they are unsure.

**Once, for everything:**

1. Which city are you in? (sets `global.location.resolved`)
2. What currency do listings show in? Usually obvious from the city.
3. How far will you travel to pick something up, in km? (`global.max_km`)

**For each thing they want:**

1. What are you looking for, as specifically as you can say it?
2. What would sellers call it in a title? Suggest two to four search terms and
   let them edit the list. (`queries`)
3. What is the most you would pay? (`pricing.max`) Below what price is it
   probably a part or a scam? (`filters.min_price`)
4. What must it have? For each one, ask whether a listing that does not mention
   it should be treated as a maybe (soft) or only ruled out when the seller
   confirms it is missing (hard). Write each as a plain sentence the assessor can
   check. (`must_have`, with `hard` true or false)
5. What would be nice but not required? Ask how much each matters, from a little
   to a lot, and map that to a weight between 0.1 and 0.6. (`nice_to_have`)
6. What is an instant no? (`dealbreakers`, short phrases)
7. Which conditions are fine: sealed, like new, good, working, fair, untested,
   broken? (`condition.accept`, and `condition.floor` is the worst they accept)
8. What makes one worth more than another: the brand, the exact edition, or the
   exact model? This picks the valuation method below.

## 6. Build the config

Start from the shape in
https://github.com/ansxn/facebook-deal-finder/blob/master/searches.example.json
— fetch it if you need the exact field names. Copy `global.pacing`, `read_depth`
and `surface_threshold_pct` unchanged.

- `id` is a short lowercase slug with dashes, for example `road-bikes`. Never
  change it after the first hunt: it is the key that keeps a search's listings
  and the user's save/pass decisions attached to it.
- `pricing.good_deal_pct` 20 and `great_deal_pct` 35 are sensible defaults.
- `title_style` describes how listings should be named on the site: brand and
  model first, then the two or three facts their rules care about.
- **Reference distances.** Set `global.location.reference_distances` to a map of
  nearby town names to their distance in km from the user's city — 12 to 20 of
  them, covering the range up to a bit past `max_km`. The assessor cannot
  geocode, so this table is the only thing keeping a two-hour drive off the
  board. Research real distances; do not guess.
- **Fair value** decides whether anything looks like a deal, so research it.
  Search the web for typical used prices of this item in their currency and
  region, then pick one method:
  - `brand_tier` when brand drives price: a few tiers, each with `brands` and a
    used `fmv`, always including one tier named `entry` for unbranded listings.
    Avoid this for categories where listings rarely name a brand.
  - `per_set_lookup` when the edition drives price: `default_in_print_fmv` plus
    `set_overrides` for editions worth more.
  - `model_lookup` when the exact model drives price: `models` with `model`,
    `new_price` and `used_fmv`, plus `unknown_model_fallback` with
    `fmv_pct_of_new_retail` around 0.55. Write models out in full — a bare brand
    fuzzy-matches the wrong product.
  - Set `reference_condition` to `good`, `confidence` to `seed`, and write a
    one-sentence `basis` saying where the numbers came from.

**Confirm before saving.** Show them a plain summary of each search — terms,
budget, must-haves, dealbreakers, conditions, rough value range — not JSON. Ask
if anything is off and fix it.

## 7. Save it

Write the config to a temp file and check it first:

```bash
. ~/.deal-finder/df.sh
df PUT '/api/searches?dry_run=1' --data-binary @"${TMPDIR:-/tmp}/searches.json"
```

`dry_run` validates without saving and tells you how many listings the config
would surface. Fix every entry in `problems` and try again until it returns
`HTTP 200`. Entries in `notes` are advisory: mention them, don't block on them.

Then save for real, same command without `?dry_run=1`:

```bash
. ~/.deal-finder/df.sh
df PUT /api/searches --data-binary @"${TMPDIR:-/tmp}/searches.json"
```

Ask them to open the website and confirm their searches are on the **Searches**
page. The Overview stays empty until the first hunt.

## 8. Show them how to use it

- **To hunt:** type `/deal-finder:hunt` in Claude Code, from any folder. Once a
  day at most; the tool enforces the gap.
- **To see results:** https://deal-finder-zeta.vercel.app. Save or pass on
  listings, and open one to see why it scored the way it did.
- **To tune a search:** the Searches page on the website. Price and threshold
  changes re-rank right away. Search terms, must-have wording and dealbreakers
  apply from the next hunt.
- **To add or drop a search, or move city:** `/deal-finder:hunt-update`.
- **To see more deals:** lower the worth-a-look threshold on the Searches page.

Then offer to run the first hunt.
