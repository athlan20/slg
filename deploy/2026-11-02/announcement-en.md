**New: Stratagems, plus wounded troops and prisoners — and a few handling improvements!**

This release adds two new systems and fixes several issues you reported.

**1. Stratagems: let your heroes fight with their wits**

- Send a hero who is **at home** to cast a stratagem. Both the effect and the success chance depend on the hero's Wit. There are 8 stratagems:
  - **Phantom Army / Empty Fort** (deception): anyone scouting your city sees a falsified garrison (Phantom Army overstates it, Empty Fort understates it). Each level of the scout's Scouting tech gives a 5% chance to see through it.
  - **Burn the Granary**: burns part of the food stored in an enemy city, up to 8%.
  - **Loot the Fire**: lowers the enemy city's warehouse protection against looting by up to 30% for 1 hour.
  - **Ambush on All Sides**: the enemy city cannot send out any troops for a while (up to 60 minutes).
  - **Golden Cicada**: shortens the remaining travel time of your returning troops, by up to half.
  - **Eight Gates Lock**: lengthens the remaining travel time of enemy troops heading for you, by up to 30%.
  - **Spy Trail**: shows the coordinates of all of a player's cities and where their troops outside are heading (no troop counts).
- Casting uses **stratagem orders**: Deception, March, Assault and Intel Orders. Orders can only be bought **with merit in the scripted-battlefield shop**. They cost no gold, cannot be traded, and reset when the season changes.
- Stratagems that can fail (Burn the Granary, Loot the Fire, Ambush on All Sides, Eight Gates Lock, Spy Trail): success chance = 50% + (your hero's Wit − the target city's governor Wit) × 1%, between 20% and 90%. The order is used up whether it succeeds or not, and the target gets an alert. Deception stratagems and Golden Cicada notify nobody.
- After casting, that hero must rest for 1 hour. A target that has been hit becomes immune to that stratagem for 6 to 24 hours; casting again during that time always fails.
- Stratagems against other players follow the protection rules: you cannot use them on a player under beginner protection or a truce, or on an ally or friendly alliance. If you cast one while under beginner protection yourself, your protection ends immediately.
- Where to find it: the map target panel, incoming-attack warnings and returning troops all have a "Cast" shortcut. You get an alert popup when a stratagem is cast on you.

**2. Wounded, prisoners and deserters: battle is no longer just life or death**

- In world-map battles, **20% of the troops you lose become wounded** instead of vanishing.
- The winner **captures 10% of the loser's losses as prisoners** (basic seven troop types only).
- When a city runs out of food and mutinies, some of the troops who leave each hour become **deserters**.
- The Army page now has a Wounded, a Prisoner and a Deserter camp. None of them eat grain, fight, or can be looted:
  - **Wounded**: heal them for 50% of their recruit cost; they return to the city and take no population.
  - **Prisoners**: recruit them for 60% of the recruit cost; this takes population. You can do this even if your Barracks level is too low to train that troop type.
  - **Deserters**: persuade them back for 50% of the recruit cost; no population is taken. Not possible while the city is still starving.
  - Wounded and prisoners **disappear after 72 hours** if not handled; deserters **after 24 hours**. You can also discard the wounded or release prisoners for free, but you get nothing back.
- Battle reports now show how many of your losses were killed, wounded or captured, and how many prisoners you took.

**3. Quality of life**

- **City names in the activity feed and Agent action log**: with more than one city, each line now says which city it happened in. (From community feedback.)
- **A clearer march list**: transport marches show what they are carrying, and clicking a march opens a detail window with troops, hero and cargo. (From community feedback.)
- **Mobile bottom navigation**: tabs such as "Star Tower" no longer wrap to two lines, and in landscape the city page's building grid no longer covers the navigation bar. (From community feedback.)

**Notes**

- Casting stratagems, healing, recruiting prisoners, persuading deserters back, discarding and releasing can all be done by players and Agents. See the protocol document (protocol version v86).
- If you use slg-mcp, please upgrade to the latest version to get the new tools.
- Success chances, effect sizes and the wounded/prisoner rates are initial settings and may be adjusted later.
