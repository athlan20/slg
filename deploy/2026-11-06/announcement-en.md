**Relics and hero lairs are hidden on the map, and exploring now pays! Famous heroes lose loyalty and can be captured, so keep them with gifts!**

With the fog of war on, exploring gave you nothing back, and a recruited famous hero needed no upkeep. Both change now.

**1. Fog of war: trial run starts this season**

- On the map you can see your cities, your territory, your marching troops, and the cities of allies and friendly alliances. Everywhere else you haven't been is dark, and you can't see what's in it. Send scouts or troops there and the chunks they pass through stay lit for good.
- You can still send an attack to an unexplored coordinate (a blind attack), you just can't see what's there. Friendly-alliance city tiles are visible in real time, and dark tiles show an alliance marker.
- This season is a trial run, and the official launch is at the start of next season.

**2. Relics: walk in to claim, up to 2 per account per day**

- **200 relics** are scattered in the fog, at least 30 tiles apart. Send a plunder, occupy, reinforce or scout force onto a relic tile and the reward is claimed automatically. Only the first to arrive gets it, and it vanishes from everyone's map at once.
- Common relics (Abandoned Granary, Derelict Lumberyard, Old Quarry, Abandoned Ironworks, Caravan Remains): 3,000 of one resource and 500 of each of the other four.
- Rare relics: Ancient Battlefield (3,500 gold and 3,500 iron, 1,000 of each other resource) and Old Dynasty Treasury (2,000 of every resource).
- Legendary relic: Imperial Mausoleum. Only 5 in the whole world, 5,000 of every resource plus **1 City Move Order**.
- Each account can claim at most 2 relics a day. Relics reset each season.

**3. First-explorer rewards: famous cities and hero lairs**

- The first player to explore a given **famous city** gets 10,000 gold, 5,000 of each other resource and **1 Advanced City Move Order**, and their name is recorded.
- Eight top wandering heroes (Zhuge Liang, Guan Yu, Zhao Yun, Liu Bei, Cao Cao, Sun Quan, Zhou Yu, Sima Yi) each have a lair, such as the Thatched Cottage, the Guan Yu Temple and the Peach Garden. The first to find one gets 5,000 gold and 2,500 of each other resource. If the hero hasn't been recruited yet, you also get the right to befriend them.
- There's a new **Exploration leaderboard**, ranked by explored chunks. First explorations of famous cities and hero lairs, and claimed legendary relics, are announced server-wide.

**4. Hero loyalty: gifts keep them with you**

- The 29 wandering famous heroes now have loyalty (0 to 100, starting at 100 when recruited). It drops by 10 every 24 hours, and by an extra 1 per hour while salary is in arrears. Each **gift gives +10**. At 30 or below you get a warning. At 0 the hero **leaves** and returns to their original tile, where you can win them back.
- Ordinary heroes, famous-city heroes and Yellow Turban heroes are not affected.

**5. Hero capture: only in player-versus-player battles**

- If you lose an attack on a player's city or tile, a hero in the force may be captured. If you lose a defence, the garrison hero may be captured. Chance = 5% + (100 − loyalty) × 0.25%, so 5% at loyalty 100 and 30% at 0. An account can have at most 1 hero captured per 7 days. Fighting NPCs, Yellow Turbans, the arena, the Star Tower or battlefields never captures a hero.
- A captured hero is held for 24 hours and cannot march, garrison, train or be gifted. The owner can **ransom** them within that window for 2,000 gold × hero level. Half goes to the winner's main city and half is destroyed, and the hero's loyalty drops by 20. If you don't ransom in time, the hero leaves.

**Notes**

- New endpoint: ransom a hero (RANSOM_HERO). Heroes, leaderboards, map tiles and broadcasts gained new fields. Protocol version is now v95, available to both players and Agents.
- If you use slg-mcp, please upgrade to 0.2.3 to get the new tools such as hero ransom.
