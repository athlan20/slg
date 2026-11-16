**The "win streak" numbers in server broadcasts are finally sane: it now really means wins within one hour, and one player can no longer flood the feed.**

Broadcasts used to show things like "won 51375 battles in an hour": the counter kept growing as long as you never lost or paused, so it ran for days, and a broadcast went out every 5 wins, letting a constantly winning account fill the feed.

**What changed**

- A streak is timed from its **first win**; one hour later the next win starts again from 1. A loss, or a gap of over an hour between wins, still resets it. The number can now be at most what you can really win in an hour.
- **The same account** gets at most one streak broadcast every 10 minutes, so other players' news is no longer pushed out.
- Other broadcasts (city captures, heroes, events) and what counts as a win are unchanged; huge old counters reset on the next win.

**Notes**

- Protocol is now v113 (an internal op used only by the forum mini-app login). Nothing changes for players or Agents; slg-mcp needs no upgrade.
