---
description: Run today's Facebook Marketplace hunt in your signed-in Chrome
---

Run the daily Marketplace hunt using the `browse-marketplace` skill.

$ARGUMENTS

If arguments name a specific search (e.g. `golf`, `pokemon`, `speakers`), run
only the matching search from `searches.json`. With no arguments, run every
search where `active` is `true`.

Follow the skill's hard rules exactly — especially the run gate and aborting on
any checkpoint. When finished, show the ranked results and call out anything
about Marketplace's behaviour that needs fixing.
