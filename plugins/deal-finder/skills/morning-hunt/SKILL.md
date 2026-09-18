---
name: morning-hunt
description: Morning deal-finder routine — checks whether a Marketplace run is due, hunts if so, otherwise reports standing deals and price drops. Use when the user says /morning-hunt, or asks for their deal-finder digest or what's new on Marketplace today. Not the general morning brief.
---

The morning routine. Deliberately semi-manual: it runs while the user is at the
machine with Chrome open and signed in, which is the only time it's safe to
browse Facebook at all.

1. See where things stand:

   ```bash
   . ~/.deal-finder/df.sh
   df POST /api/run -d '{"action":"status"}'
   ```

2. **If `can_run` is true**, say so and run the `hunt` skill for every active
   search. Ask first if the user seems to be mid-task — this takes a few minutes
   of their browser.

3. **If `can_run` is false**, don't browse. Show what's already there and report
   the standing deals plus how long until the next run is allowed (`min_hours`
   minus `hours_since`):

   ```bash
   . ~/.deal-finder/df.sh
   df GET '/api/deals?view=compact&top=10'
   ```

4. Either way, finish with a short digest:
   - the top of the ranking: new listings since yesterday first, best first,
     each with its flags if it has any (nothing is auto-rejected — a flagged
     listing is a low-ranked one, not a hidden one)
   - any price drops on listings already seen
   - anything that needs a decision from them (a low-confidence valuation, a
     listing whose specs couldn't be read)

Keep it short. Most mornings the honest answer is "nothing good today" — say
that plainly rather than padding it with near-misses.

## Making it fire on its own

There's no unattended version of this and there shouldn't be: browsing Facebook
on a schedule with nobody watching is exactly the pattern that gets an account
flagged. What can be automated is the *reminder*.

If the user wants that, offer to set up a scheduled task that pings them each
morning to run `/deal-finder:morning-hunt` — ask before creating it, since it's
persistent config. A calendar event or a macOS reminder works just as well.
