# Facebook Marketplace Deal Finder

A personal tool that browses Facebook Marketplace once a day for the items I'm
hunting, scores each listing against fair market value, and surfaces only the
genuinely good new ones.

Not a scraper. It drives **my own signed-in Chrome** through Claude in Chrome, at
human pace — a handful of searches once a day. See
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for why that constraint shapes the
whole design, and for the pacing rules the browse routine enforces.

## Status

Built in phases, each one tested before the next starts.

| Phase | What | State |
|---|---|---|
| 1 | **Intake** — interview → editable `searches.json` | 🚧 in progress |
| 2 | **Browse routine** — one category (golf) end to end | ⬜ |
| 3 | **Valuation & scoring** — fair value + deal score | ⬜ |
| 4 | **All three searches** + cross-run dedupe | ⬜ |
| 5 | **Dashboard** — localhost, ranked results, run button | ⬜ |
| 6 | **Daily trigger** — morning prompt, semi-manual by design | ⬜ |

Phase 2 is expected to eat most of the iteration time. Marketplace's DOM shifts,
its filters are inconsistent, and results are location-gated — the interface and
the scoring math are the easy parts.

## Layout

```
searches.json          what I'm hunting — hand-editable, also written by the dashboard
.claude/skills/        the browse routine (a Claude skill, not code)
scripts/               ingest, dedupe, scoring — plain Node, no dependencies
dashboard/             localhost UI
data/                  local listing store + my seen/dismissed verdicts (gitignored)
docs/                  architecture and notes
```

## Requirements

- Node (no npm dependencies — everything is stdlib)
- Chrome, signed in to Facebook
- Claude Code with Claude in Chrome available
