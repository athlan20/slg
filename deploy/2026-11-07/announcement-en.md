**Watchtowers for your wilderness, hills see further, and other players' troops show up once they enter your sight! Wilderness of long-absent accounts will be reclaimed!**

Three problems this time: wilderness did nothing but produce resources, you couldn't see what others were doing under the fog of war, and abandoned accounts held their land forever.

**1. Watchtowers: build one on your wilderness to light up the area around it**

- Tap "Watchtower" on a wilderness tile you **hold**: it builds a new one, or upgrades an existing one, up to Lv3. Vision radius **6 / 8 / 10 tiles** (a wilderness tile only had 3 before; the watchtower replaces it, no stacking).
- Cost: Lv1 300 gold, 200 wood, 100 stone; Lv2 600 / 400 / 200; Lv3 900 / 600 / 300. Paid by the city that holds the tile.
- Each city can have **2** watchtowers on its wilderness (main city 2, each branch city 2). They have their own timer and **don't use the city build queue**.
- Others can see your watchtower and its level. To blind you, they have to take the tile.
- A watchtower is destroyed if the tile is taken, its branch city changes hands, you recall the garrison and give up the tile, or the account is reclaimed for long absence. It is not passed on, and nothing is refunded.

**2. Hills: higher ground, longer sight**

- A **hill** wilderness tile you hold gets **+2** vision: 3 → 5 without a watchtower, 8 / 10 / 12 with a Lv1 / 2 / 3 one. The cap is 12, same as a main city.
- Only held wilderness is affected. Main cities, branch cities and marching troops ignore terrain. Open a hill tile and you'll see "High ground: vision +2".

**3. See other players' troops on the map**

- Other players' marching troops show up on the map once they enter your **live vision** (main city 12 tiles, branch city 8, held wilderness, watchtowers, your marching troops, scouts) and vanish when they leave. Allies don't share vision.
- You see: position, heading, outbound or returning, owner and alliance, and a size class (small 1-499, medium 500-4,999, large 5,000+). You don't see: where they came from, where they're going, when they arrive, or exact troop counts, types and heroes.
- Colours: red is attacking you, orange is a hostile alliance, grey is neutral, green is ally and friendly alliance. Tap an icon for a short note. Scouts and troops lying in ambush are not shown.
- Shown under the "Marches" layer, refreshed every 5 seconds, up to the 50 nearest to the window centre. **For now you can only watch, not intercept.**
- On phones, the map card header has a new "Layers" button that lets you toggle every layer.

**4. Long absence: your wilderness gets reclaimed**

- If **both you and your Agent** stay offline for over 7 days (real time), the server checks hourly and reclaims **all your wilderness** at once: the tiles become unowned and anyone can take them right away; garrisons return to their city with no losses. **Your cities, their resources and troops are untouched.**
- Reclaimed tiles aren't given back. Tiles you take after returning are reclaimed again only after another 7 days offline. The event log and offline report tell you how many were taken for long absence.
- Playing yourself or through an Agent both count as online. There was a bug: an Agent's login, presence and disconnect didn't refresh activity, so an alliance leader who played only through an Agent lost the leader seat after 7 days. That is fixed, and Agents count as active.
- Note: the first check after this release will reclaim the wilderness of accounts already absent for over 7 days.

**Notes**

- New endpoints: FACILITY_BUILD (build or upgrade a watchtower) and GET_VISIBLE_MARCHES (other players' troops in sight). Protocol version is now v98. Players and Agents can both use them; see the protocol docs.
- slg-mcp users: please upgrade to 0.2.4 to get the watchtower and visible-troops tools.
