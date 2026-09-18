# Deal Finder

Hunts Facebook Marketplace in your own signed-in Chrome once a day, works out
what each listing is really worth, and ranks them on a hosted dashboard.

## Commands

- `/deal-finder:setup` — first-time setup: connect your account and say what you
  want to hunt
- `/deal-finder:hunt` — run today's searches
- `/deal-finder:morning-hunt` — hunt if one is due, otherwise report what's
  standing and any price drops
- `/deal-finder:hunt-update` — add or drop a search, or move city

## Requirements

Chrome signed in to Facebook, and Claude Code with the Claude in Chrome
extension connected. Nothing is installed locally and there is no project
folder — the skills talk to a hosted API.

## How it works

Facebook blocks automated browsing, so the browsing happens in your real
browser, at human pace, at most once a day. Everything after that — dedupe, fair
value, scoring, ranking — happens on the server. Scores are recomputed on every
read rather than stored, so changing a budget re-ranks everything you have ever
seen, immediately.

Your credentials live in `~/.deal-finder/env`. Your searches and listings live in
your own account on the dashboard.

Source: https://github.com/ansxn/facebook-deal-finder
