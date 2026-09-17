# Deal Finder: start here

Someone sent you this so an AI can set you up with Deal Finder. It watches
Facebook Marketplace for things you want, works out what each listing is really
worth, and ranks them on a website so the good deals are at the top.

**What you need:** a computer with Google Chrome, a Facebook account, and
[Claude Code](https://claude.com/claude-code). Setup takes about 20 minutes.

**What to do:** save this file, open Claude Code in any folder, and say:

> Read START-HERE.md and set me up.

Everything below is written for the AI.

---

## For the AI doing the setup

You are onboarding someone who is probably not a developer. Keep messages
short, ask one question at a time, use plain words, and do the technical work
yourself. Follow the stages in order. Do not skip ahead to a stage that depends
on an earlier one.

### Ground rules

- **Never ask for, see, or type a password.** The person creates their account
  on the website themselves. The only secret you handle is the push token they
  paste to you, and it goes in `.env.local` and nowhere else.
- **Do not browse Marketplace during setup.** The only browsing happens in the
  optional first hunt at the end, and it follows the `hunt` skill exactly.
- **Never message a seller, buy anything, or get past a CAPTCHA or login check.**
- If a step fails and the fix is not in Troubleshooting below, stop and tell the
  person to ask whoever sent them this file. Do not improvise workarounds.

### How the tool works (context for you)

- **Hunting** happens in Claude Code. A skill called `hunt` drives the person's
  own signed-in Chrome through the Claude in Chrome extension, runs their
  searches at human pace at most once a day, and reads each listing's page,
  description and photos. Facebook blocks automated scraping, which is why it
  is their browser, slowly, and never a script.
- **Scoring** is plain local Node (no dependencies). Every listing gets a fair
  value estimate, a score and a clean name. Nothing is auto-hidden; rule misses
  lower a score and say why.
- **The website** is shared: https://deal-finder-zeta.vercel.app. Each person
  has a private account. At the end of each hunt, results are pushed there with
  a personal push token. On the site they browse the ranking, save or pass on
  listings, and tune their searches with sliders. Those edits are pulled back
  down before the next hunt.
- **Config** lives in `searches.json` in the project folder. Its shape is shown
  in `searches.example.json` and explained in `docs/searches.schema.md`.

### Stage 1: Check the computer

Run these checks yourself and fix what you can.

1. `node -v` must print v20 or newer. If Node is missing or old, tell the person
   to install the LTS version from https://nodejs.org, then check again.
2. `git --version` must work. On a Mac, `xcode-select --install` provides it.
3. Claude in Chrome must be connected. Look for tools whose names contain
   `claude-in-chrome` (search your deferred tools if needed). If they are not
   there, tell the person to install the Claude in Chrome extension from
   https://claude.com/chrome, sign in, and connect it to Claude Code, then
   restart this session. Stop until it is connected.
4. Ask the person to confirm Chrome is signed in to Facebook and that
   https://www.facebook.com/marketplace opens for them.

### Stage 2: Get the tool

Clone it into their home folder:

```bash
git clone https://github.com/ansxn/facebook-deal-finder.git ~/deal-finder
```

If the clone fails with "not found" or asks for credentials, the repository is
private. Tell the person to send their GitHub username to whoever sent them
this file, accept the invitation email, then run `gh auth login` (install the
GitHub CLI from https://cli.github.com if needed) and clone again.

From here on, run every command inside `~/deal-finder`.

### Stage 3: Explain the flow

Give the person this rundown in your own words, briefly:

1. You tell me what you are looking for, your budget, and what is a
   dealbreaker. I turn that into your searches.
2. Once a day you open Claude Code in the deal-finder folder and type `/hunt`.
   It uses your Chrome, slowly, like a person would, for about 15 to 40
   minutes. Keep Chrome open while it runs.
3. Each listing gets a fair price estimate, a score, and a clear name, even
   when the seller's title is a mess.
4. Results appear on the website, best deals first, with the reasons shown.
   Save the ones you like, pass on the rest, and open the listing to message
   the seller yourself.
5. You can change budgets, dealbreakers and search terms on the website any
   time. The next hunt follows them.

Then ask if they have questions before continuing.

### Stage 4: Create their account

1. Ask them to open https://deal-finder-zeta.vercel.app, choose **Create an
   account**, and sign up with their email and a password of at least 10
   characters. If it asks for an invite code, they get it from whoever sent
   this file.
2. Right after signup the site shows a **push token** once. Ask them to copy it
   and paste it to you. It starts with `dfp_`.
3. Write `~/deal-finder/.env.local`:

   ```
   DEALFINDER_API_URL=https://deal-finder-zeta.vercel.app
   DEALFINDER_PUSH_TOKEN=<the token they pasted>
   ```

4. Test it with `node scripts/pull-config.mjs`. It should report that there is
   no config on the dashboard yet. A 401 means the token was copied wrong; ask
   them to use **Account > Regenerate** on the site and paste the new one.

### Stage 5: Interview them about what to hunt

Start with at most three searches. Ask conversationally, one question at a
time, and offer examples when they are unsure. Record answers as you go.

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
4. What must it have? For each one, ask whether a listing that does not
   mention it should be treated as a maybe (soft) or only rule it out when the
   seller confirms it is missing (hard). Write each as a plain sentence the
   assessor can check. (`must_have`, with `hard` true or false)
5. What would be nice but not required? Ask how much each matters, from a
   little to a lot, and map that to a weight between 0.1 and 0.6.
   (`nice_to_have`)
6. What is an instant no? (`dealbreakers`, short phrases)
7. Which conditions are fine: sealed, like new, good, working, fair, untested,
   broken? (`condition.accept`, and `condition.floor` is the worst one they
   accept)
8. What makes one worth more than another: the brand, the exact edition, or
   the exact model? This picks the valuation method below.

**Build the config.**

- Start from `searches.example.json`. Copy `global.pacing`, `read_depth` and
  `surface_threshold_pct` exactly. Replace the location, currency and
  `max_km` with their answers. Replace all three example searches with theirs;
  the examples belong to the person who sent this file.
- `id` is a short lowercase slug with dashes, for example `road-bikes`. Never
  change it after the first hunt.
- `pricing.good_deal_pct` 20 and `great_deal_pct` 35 are sensible defaults.
- `title_style` describes how listings should be named on the site: brand and
  model first, then the two or three facts their rules care about. Write an
  example in the same shape as the ones in `searches.example.json`.
- **Fair value** decides whether anything looks like a deal, so research it.
  Search the web for typical used prices of this item in their currency and
  region, and pick one method:
  - `brand_tier` when brand drives price: a few tiers, each with `brands` and a
    used `fmv`, and always one tier named `entry` for unbranded listings.
  - `per_set_lookup` when the edition drives price: `default_in_print_fmv`
    plus `set_overrides` for editions worth more.
  - `model_lookup` when the exact model drives price: `models` with `model`,
    `new_price` and `used_fmv`, plus `unknown_model_fallback` with
    `fmv_pct_of_new_retail` around 0.55.
  - Set `reference_condition` to `good`, `confidence` to `seed`, and write a
    one-sentence `basis` saying where the numbers came from.

**Confirm before saving.** Show them a plain summary of each search (terms,
budget, must-haves, dealbreakers, conditions, rough value range), not JSON. Ask
if anything is off and fix it.

### Stage 6: Send it to the website

1. Save the file as `~/deal-finder/searches.json`.
2. Run `node scripts/check-config.mjs`. Fix every line starting with `fix:` and
   run it again until it prints `ok`.
3. Run `node scripts/push.mjs`. It should report 0 listings and the searches
   config pushed.
4. Ask them to open the website, go to **Searches**, and confirm their searches
   are there. The Overview stays empty until the first hunt.

### Stage 7: Show them how to use it

Tell them:

- **To hunt:** open Terminal, run `cd ~/deal-finder && claude`, then type
  `/hunt`. Once a day at most; the tool enforces a gap between runs.
- **To see results:** open https://deal-finder-zeta.vercel.app. Save or pass
  on listings, and open one to see why it scored the way it did.
- **To change what it looks for:** use the Searches page on the website. Price
  and threshold changes re-rank right away. Search terms, must-have wording and
  dealbreakers apply from the next hunt.
- **To see more deals:** lower the worth-a-look threshold on the Searches page.

Then offer to run the first hunt. Skills load from the project folder, so the
hunt has to start in a new Claude Code session opened in `~/deal-finder`. Tell
them to run `cd ~/deal-finder && claude` and type `/hunt`, keep Chrome open,
and leave it alone while it works.

### Troubleshooting

| What they see | What to do |
|---|---|
| `node` not found or older than v20 | Install the LTS version from nodejs.org, then reopen Terminal. |
| Clone says not found | The repository is private. Get invited (Stage 2). |
| No `claude-in-chrome` tools | Install and connect Claude in Chrome, then restart Claude Code. |
| Signup asks for an invite code | Get it from whoever sent this file. |
| Signup says the instance is full | Ask whoever sent this file to raise the user limit. |
| 401 from `pull-config` or `push` | The token is wrong or was regenerated. Use Account > Regenerate and update `.env.local`. |
| `check-config` prints `fix:` lines | Correct `searches.json` as each line says, then run it again. |
| `/hunt` says it is too soon | Runs are spaced out on purpose. Try again later. |
| Facebook shows a CAPTCHA or "confirm it's you" | The hunt stops by design. The person clears it themselves in Chrome, and hunts again tomorrow. |
| Website shows "Almost set up" | The searches were not pushed yet. Run Stage 6. |
