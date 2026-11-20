**The five factions now hold grudges: top-ranked players and anyone who has attacked a lair are targeted first, even if their branch city is far from the lair. Attacking a lair also gives far more prestige: 1 point of prestige per 1 point of garrison power destroyed.**

This update (v0.2.11 → v0.2.15) has two main parts, faction grudges and higher lair prestige, plus two smaller changes.

**1. Faction grudges: sieges no longer depend only on "closest to the lair"**

Until now a faction only picked the branch city closest to its lair within its range. Top players were never reached, and the siege army only scaled with the government-office level, so sieges were easy to ignore. Now each faction keeps a "hatred" value for each player and picks high-hatred players first.

- **Where hatred comes from**: two parts added together.
  - **The top 20 of the power ranking** start with some base hatred, higher for higher ranks. It refreshes daily, and each of the five factions computes its own.
  - **Attacking that faction's lair**: every battle adds the garrison power you destroyed as hatred (losses count too), and it decays over time with a half-life of 3 days, so it fades if you stop.
  - It resets at season change. The cumulative contribution on the destruction ranking is not affected.
- **Who gets sieged**: when a faction starts a siege it first looks at its own hatred ranking: highest hatred first; ties go to the higher power-ranking position, then to the shorter distance from the lair. It sieges that player's **branch city closest to the lair**. **The city no longer has to be inside the faction's range**: a top-20 account is sieged even from the other side of the map. Only when nobody on the list qualifies does it fall back to the old "closest to the lair within range".
- **One account can be sieged by at most 1 faction at a time**; accounts already under siege by another faction are skipped.
- **Siege army strength follows the target**: siege power = the larger of (government-office level × multiplier, **the target account's current power × a ratio**), then multiplied by the suppression tier. The ratio depends on season day: 10% on days 8–14, 14% on days 15–21, 18% from day 22. Taking the larger value means **small and mid-size players face the same siege armies as before, no worse**; big accounts face noticeably stronger ones.
- **Are you being watched?** The faction panel has a new "Hatred" line for each faction showing only your own tier: **Prime target** (top 5 on that faction's list), **Noticed** (6th–20th), or **None**. Exact values are not shown, and you cannot see anyone else's tier. A siege warning now tells you whether it was chosen by hatred.
- **How to avoid it**: send reinforcements, or push that faction's lair into a suppression tier (one tier per 5 camps destroyed; siege armies are reduced to 100 / 75 / 50 / 25%).
- Unchanged: sieges start on day 8, at most 1 city per faction at a time, at most 2 captured per week (1 at tier 3 suppression), 60-minute warning, the same city at most once every 6 hours, 24-hour cooldown after a failed siege, durability −35 / 4-hour truce / captured at zero. Main cities and famous-city branches are still never sieged.

**2. Much more prestige from lairs**

Until now each lair battle gave prestige equal to only **1%** of the garrison power you destroyed, so many fights barely moved the number. It is now **1 : 1**, the same as other battles on the world map:

- **1 point of garrison power destroyed = 1 point of prestige** (before, it took 100 points for 1), a 100× increase.
- It is still **settled per battle, and losses count too**, not only for the last hit.
- Everything else is unchanged: gold 2 / wood, food, stone and iron 10 each per point destroyed, the leader hero for the last hit, and the ranking rewards on destruction.

**3. Other**

- **Window width**: the full layout now starts at **1240** instead of 1280, so common 1260-wide windows (split screens, smaller laptops) get the full layout too. On the map page the faction cards in the right column are paged when all five do not fit, instead of being cut off.
- **Newcomer connect dialog**: a newly registered account that has never connected an Agent gets a one-screen prompt with one button that copies the connection prompt; paste it to your AI and you are set. "Don't show again" stops it on this device. The Agent panel also has a permanent entry for the same guide.

**Notes**

- Protocol is now v116. Faction grudges (v116): factions[] in GET_FACTIONS adds hatredTier (none / noticed / target, only for the requester); the warning in PUSH_FACTION_SIEGE adds an optional byHatred; a new table faction_hatred (cleared at season change). Lair prestige (v114) only changes numbers, no fields added or removed. GET_AGENT_INFO adds accountCreatedAt (v115, account creation time, read-only). Players and Agents can both use these; see the protocol doc.
- If you use slg-mcp, please upgrade to the latest version (0.2.15).
