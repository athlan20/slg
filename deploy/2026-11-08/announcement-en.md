**New season, five factions on the map: Liangzhou Rebels, Wuhuan, Nanman, Shanyue, Heishan Army! They swallow NPC cities, raid under their banner, besiege your branch cities, and the whole server can tear down their lairs!**

NPCs used to each do their own thing; now a faction sits in every corner and the centre, and its land grows weekly. We also fixed a bug that made the season change fail.

**1. Five factions, five lairs**

Liangzhou Rebels (Han Sui) at (80, 80); Wuhuan (Tadun) at (920, 80); Nanman (Meng Huo) at (80, 920); Shanyue (Fei Zhan) at (920, 920); Heishan Army (Zhang Yan) at (500, 500).

- Lair coordinates are public (no fog). No player city within 5 tiles.
- **Territory** is a square around the lair: radius 100 on days 1-7, 150 on days 8-14, 200 on days 15-21, 250 from day 22. Overlaps go to the nearer lair.
- **Swallowing**: at season start every NPC city within 25 tiles of a lair joins it; then each faction swallows 1 random NPC city in its territory every 6 hours. Famous and player cities are safe.
- Faction cities can be scouted, plundered and taken; garrison and stock are **1.5x** a normal NPC city. Take one and it leaves the faction.
- New map layer "Faction territory" and a faction panel.

**2. Factions fight back**

- **Raids carry a banner** ("Nanman is raiding") in warnings, events and reports. Raid frequency is unchanged.
- **Sieges**: once the season is 7 days old, each faction besieges player **branch cities** in its territory. Main cities are never touched, as are famous-city branches (Luoyang too) and cities under protection or truce.
  - One city at a time per faction, the nearest to its lair; a city is hit at most once per 6 hours, and after a repelled siege that faction leaves it alone for 24 hours. At most **2 cities per faction per week**.
  - Force = town hall level x 100 (days 8-14), 150 (days 15-21) or 200 (day 22 on). Walls, towers and reinforcements count.
  - **60 minutes** of warning (beacon bonuses apply), showing the city's defence value.
  - A faction win costs 35 defence and gives a 4-hour truce with no plunder; defence regains 10 per hour afterwards. At 0 the city falls: **30 hours at the fastest**. Only thin garrisons are at risk.
- **A fallen city** keeps its buildings; resources become plunderable stock, queues are cancelled, wilderness becomes unowned, the garrison goes home. The owner gets the slot back and a broadcast goes out.
- **Anyone can take it** with buildings and stock; the old owner is **not** bound by the abandon cooldown.

**3. Lairs can be broken**

- A lair has **20 camps**; you fight only the current one, in a city defence battle (walls cut damage 50%). Damage stays even if you lose; **cleared camps never return**. After 24 hours without attack, 1 camp is restored.
- Camp strength = top-10 server power / 15, refreshed daily, never falling, minimum 10,000.
- Open to everyone. It doesn't break newbie protection.
- **Annihilation reward**, paid after every battle **even in defeat**: per point of garrison power destroyed, 2 gold and 10 each of wood, food, stone, iron, credited to your sending city with no load cost. Prestige is 1% of that.
- The **final blow** wins the faction leader as a hero (unique; roster 40 to 45) and a broadcast.
- **Ranking payout** on destruction, by damage dealt: 1st 18,000 gold + 90,000 each resource; 2nd-3rd 12,000 / 60,000; 4th-10th 7,500 / 36,000; other participants 2,400 / 9,000.
- **Afterwards** that faction stops swallowing and besieging, its cities become normal NPC cities, swallowed player cities keep their buildings and stock, and the lair is a ruin. All five return next season.

**4. Fix**

- Fixed the season change failing when an alliance held Luoyang at season end.

**Notes**

- Factions start with the new season; the current one is unaffected.
- New: GET_FACTIONS; tiles carry a faction field; MARCH / SCOUT can target a lair. Protocol v101, see the docs.
- slg-mcp users: please upgrade to 0.2.5 for the faction tool.
