# Deal Finder: start here

Deal Finder watches Facebook Marketplace for the things you want, works out what
each listing is really worth, and ranks them on a website so the good ones are at
the top. It browses in your own Chrome, slowly, once a day, like a person would.

**What you need:** Google Chrome signed in to Facebook, a Facebook account, and
[Claude Code](https://claude.com/claude-code). Nothing else to install. Setup
takes about five minutes, most of which is answering questions about what you
want to buy.

---

## 1. Add the plugin

Open Claude Code — any folder, it doesn't matter — and run these two lines:

```
/plugin marketplace add ansxn/facebook-deal-finder
```

```
/plugin install deal-finder@deal-finder
```

Then restart Claude Code so the new commands load.

## 2. Set yourself up

Type this and follow along:

```
/deal-finder:setup
```

It will ask you to create an account on
[the website](https://deal-finder-zeta.vercel.app), then interview you about
what you're hunting: what it is, what you'd pay, what it must have, what's an
instant no. Answer in plain words. It looks up what those things actually sell
for and writes your searches for you.

You never type a password anywhere except the website's own signup form.

## 3. Hunt

```
/deal-finder:hunt
```

Chrome will start working. It runs your searches one at a time, opens listings,
and reads them — about 15 to 40 minutes. Keep Chrome open and leave it alone
while it runs; you can go do something else.

When it finishes, open [the website](https://deal-finder-zeta.vercel.app). Best
deals at the top, each with the reasons it scored that way. Save the ones you
like, pass on the rest, and open a listing to message the seller yourself.

---

## Day to day

| What you want | What to type |
|---|---|
| Run today's hunt | `/deal-finder:hunt` |
| Just tell me what's new | `/deal-finder:morning-hunt` |
| Add or drop a search, or move city | `/deal-finder:hunt-update` |
| Change a budget or loosen a rule | Use the sliders on the website |

Once a day is the limit, and it's enforced. Facebook doesn't like being browsed
by robots, so this one goes at human speed and doesn't go twice.

## If something goes wrong

| What you see | What it means |
|---|---|
| `/deal-finder:hunt` isn't recognised | The plugin didn't load. Restart Claude Code and check `/plugin`. |
| "Too soon — minimum gap is 18h" | Working as intended. It tells you how long to wait. |
| Facebook shows a CAPTCHA or "confirm it's you" | The hunt stops on purpose. Clear it yourself in Chrome and hunt again tomorrow. |
| "invalid or missing push token" | Your token is wrong or was regenerated. Go to **Account > Regenerate** on the website and run `/deal-finder:setup` again. |
| The website says "Almost set up" | Your searches were never saved. Run `/deal-finder:setup`. |
| Claude gets HTML back instead of data | The site's deployment protection is on. Whoever runs the instance has to turn it off. |
| Everything fails at once | The website or its database is down. The hunt needs them — there's no offline mode. Try later. |

Anything else, ask whoever sent you this.
