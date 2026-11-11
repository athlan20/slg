**Faction lairs now scale from weak to strong, and breaking them weakens the faction! Battle loss scaling is back to normal, every account can win its own wild hero, and the battlefield shows your entry formation.**

Players told us the lairs were too strong to break, so we reworked them and updated a few battle and hero features.

**1. Lair camps scale from weak to strong**

- Before, all 20 camps were equally strong, so only the top players could touch them. Now **camp 1 is the weakest and camp 20 the strongest, growing camp by camp**. Strength follows the overall strength of the server, is refreshed daily and **never decreases**.
- The early camps are easier to break; the later ones are harder. Destroying a whole faction still takes the top players and alliances.
- Existing lairs switch to the new strength on the first refresh after the update (a one-time change); the current camp keeps its damage ratio and cleared camps stay cleared.
- Unchanged: 20 camps, 50% wall reduction, 1 camp restored after 24 hours without attack, annihilation rewards (even in defeat), the ranking payout and the leader heroes.

**2. Breaking lairs suppresses the faction**

Faction strength used to ignore how many camps you had cleared. Now **the more camps are cleared, the weaker that faction gets**: one level per 5 camps, up to level 3. The higher the level, the **weaker its siege forces and the slower it swallows NPC cities**; at the top level it can also take fewer player branches per week.

- The level follows the remaining camps, so **it drops when camps are restored** (24 hours without attack). Keep attacking to keep it suppressed.
- Siege force is fixed when a siege starts; sieges already on the way don't change. Raid frequency, territory radius and siege pacing are unchanged.
- The faction panel shows each faction's level and effects, and level changes are broadcast.

**3. Battle loss scaling is back to normal**

- Battle loss scaling is now working normally, and all battles use the same loss rules.

**4. Every account gets its own wild heroes**

- The 29 wild heroes are no longer first-come-first-served: **each account runs the whole process itself** (beat the guards, befriend, reach 100 favour, recruit) without affecting others. Steps and numbers are unchanged.
- The 8 famous-city heroes, 3 Yellow Turban heroes and 5 faction leaders stay unique server-wide.
- Wild-hero tiles **can't be occupied**; beat the guards and befriend instead.
- After recruiting, your befriending progress resets; after dismissing or release you can start over without touching anyone else's progress.

**5. Battlefield entry formation**

- After entering a scenario battlefield the panel shows your **entry formation** (troops by type, total troops and population); My Squads shows each squad's troop breakdown and follows splits and losses.

**Notes**

- New / changed: GET_FACTIONS adds suppression per faction and campPower now means the current camp; GET_HEROES famousClaims adds ownerCount; new error code WILD_HERO_UNOCCUPIABLE. Protocol is now v107 for both players and Agents; see the protocol docs.
- slg-mcp users: please upgrade to the latest version (0.2.7).
