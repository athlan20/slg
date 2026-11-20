**The five factions now hold grudges: top-ranked players and anyone who has attacked a lair are targeted first, even if their branch city is far from the lair. Attacking a lair also gives far more prestige: 1 point of prestige per 1 point of garrison power destroyed.**

This update (v0.2.11 → v0.2.15) has two main parts, faction grudges and higher lair prestige, plus two smaller changes.

**1. Faction grudges: sieges no longer depend only on "closest to the lair"**

Until now a faction only picked the branch city closest to its lair within its range. Top players on the power ranking were never reached, and the siege army only scaled with the government-office level, so sieges were easy to ignore. Now each faction holds a grudge against players and goes after the ones it resents most.

- **Who gets a grudge**: players near the top of the power ranking, and players who have attacked that faction's lair. The more and the harder you attack, the more that faction remembers you; if you stop for a while the grudge slowly fades. Each faction keeps its own, and it resets at season change.
- **Who gets sieged**: players the faction resents more are sieged first, **even if their branch city is outside the faction's range**. Only when it resents nobody does it fall back to the old "closest to the lair within range".
- **One account can be sieged by at most 1 faction at a time.**
- **Siege armies scale with the target**: big accounts near the top of the power ranking face noticeably stronger siege armies than before; **small and mid-size players face the same siege armies as before, no worse**.
- **Are you being watched?** The faction panel has a new "Hatred" line for each faction showing only your own tier: **Prime target**, **Noticed**, or **None**. Exact values are not shown, and you cannot see anyone else's tier. A siege warning now tells you whether it was chosen because of a grudge.
- **How to avoid it**: send reinforcements, or push that faction's lair into a suppression tier (each batch of camps destroyed raises one tier and weakens its siege armies).
- Unchanged: sieges start on day 8, at most 1 city per faction at a time, 60-minute warning, the same city at most once every 6 hours, 24-hour cooldown after a failed siege. Main cities and famous-city branches are still never sieged.

**2. Much more prestige from lairs**

Until now each lair battle gave prestige equal to only **1%** of the garrison power you destroyed, so many fights barely moved the number. It is now **1 : 1**, the same as other battles on the world map:

- **1 point of garrison power destroyed = 1 point of prestige** (before, it took 100 points for 1), a 100× increase.
- It is still **settled per battle, and losses count too**, not only for the last hit.
- Everything else is unchanged: the gold and resources for destroying garrisons, the leader hero for the last hit, and the ranking rewards on destruction.

**3. Other**

- **Window width**: the full layout now starts at **1240** instead of 1280, so common 1260-wide windows (split screens, smaller laptops) get the full layout too. On the map page the faction cards in the right column are paged when all five do not fit, instead of being cut off.
- **Newcomer connect dialog**: a newly registered account that has never connected an Agent gets a one-screen prompt with one button that copies the connection prompt; paste it to your AI and you are set. "Don't show again" stops it on this device. The Agent panel also has a permanent entry for the same guide.

**Notes**

- Protocol is now v116. Faction grudges (v116): factions[] in GET_FACTIONS adds hatredTier (none / noticed / target, only for the requester); the warning in PUSH_FACTION_SIEGE adds an optional byHatred. Lair prestige (v114) only changes numbers, no fields added or removed. GET_AGENT_INFO adds accountCreatedAt (v115, account creation time, read-only). Players and Agents can both use these; see the protocol doc.
- If you use slg-mcp, please upgrade to the latest version (0.2.15).
