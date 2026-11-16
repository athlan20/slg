**Famous cities are no longer held forever: one per player, a 7-day tenure, then they are up for grabs again. Also, you can now play SLG inside the Linux.do forum, and the "win streak" numbers in broadcasts are fixed.**

This update (v0.2.10 → v0.2.11) has three parts: famous-city tenure rotation, the Linux.do mini-app, and the streak broadcast fix.

**1. Famous cities: 7-day tenure**

Until now a famous city, once taken, was yours for good, and the 8 of them sat with a handful of accounts for weeks. They now rotate:

- **Each account can hold at most 1 famous city at a time.** If you already have one, trying to take another (an unowned one, or one captured from another player) is refused until your tenure ends or you give the city up.
- **Tenure is 7 days**, counted from the moment you take the city. The remaining time is shown on the city page and on the map.
- **You get a reminder 24 hours and 1 hour before it ends.** When it ends the city goes back to being an unowned famous city (outer garrison and city garrison at full strength), and a server broadcast is sent.
- At expiry, the garrison in the city, the garrison on its wildernesses and your troops out in the field return to your main city; the city's **buildings, stock and build / recruit / research queues are lost with it** (same as discarding a branch city). Use or move your resources before then.
- **The previous holder who lost the city by expiry cannot take it back for 48 hours.** In that time they may take other famous cities, attack this one's outer garrison, or plunder it. The UI warns you before you try ("already hold a famous city" or "banned until …").
- **Being captured by another player is not an expiry**: the new holder's tenure starts again at 7 days and the old holder is not banned.
- Everything else about famous cities (unique effects, +20% production, elite troops) is unchanged, and Luoyang follows the same rules.
- **After this update, existing famous cities get 7 days counted from the update**, so the first batch will expire around the same time; plan ahead if you want to keep yours. At the start of a new season tenure and bans are cleared, and the cities are contested from scratch.

**2. Linux.do mini-app**

- Find **SLG** in the mini-app entry on the Linux.do forum and open it: **no separate sign-up and no password**, you are signed in with your forum identity.
- The mini-app uses the **same account system as the website**: if you have signed in with Linux.do before, you get the same account with the same progress; if it is your first time, an account is created automatically.
- Gameplay, numbers and seasons are exactly the same as the website. It is not a separate server.
- **No trust level requirement**: new users at level 0 can play too, for both the mini-app and the Linux.do web login. Your forum account must still be active and not silenced.
- The mini-app follows the forum's light/dark theme. Theme skin, language, map zoom and chat read position are saved on your device; **the session token is not saved**.
- The mini-app has **no top-up entry**, no third-party account binding and no external links. Redeem codes work as usual. To top up or bind accounts, please use the website.
- If the server cannot be reached you get a clear connection-failed message instead of an endless spinner; if you are not signed in to the forum, only a notice page is shown.

**3. Win streak broadcast fix**

Broadcasts used to show things like "won 51375 battles in an hour": the counter kept growing as long as you never lost or paused, so it ran for days, and a broadcast went out every 5 wins, letting a constantly winning account fill the feed.

- A streak is timed from its **first win**; one hour later the next win starts again from 1. A loss, or a gap of over an hour between wins, still resets it. The number can now be at most what you can really win in an hour.
- **The same account** gets at most one streak broadcast every 10 minutes, so other players' news is no longer pushed out.
- Other broadcasts (city captures, heroes, events) and what counts as a win are unchanged; huge old counters reset on the next win.

**Notes**

- Protocol is now v113. Famous-city tenure (v111) adds: error codes FAMOUS_LIMIT / FAMOUS_BANNED, famousExpiresAt (expiry time) on cities and tiles, tile.bannedUntil, events / pushes famous_expiring / famous_expired, and famousCount / famousLimit in GET_STATE. The mini-app (v113) only adds an internal login message. Players and Agents can both use these; see the protocol doc.
- If you use slg-mcp, please upgrade to the latest version (0.2.11).
