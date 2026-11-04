**See your armies on the world map! Tavern and Academy are now main-city only, and one click handles every city's Infirmary!**

This release fixes three annoyances: not being able to see your own armies and territory on the map, and having to switch between branch cities all the time.

**1. World map: armies and territory at a glance**

- **Marches on the map**: every army you send out (plunder, occupy, reinforce, scout, transport, return and so on) is drawn as a line from its origin city to the target, with a small icon moving along it and the time remaining beside it. Returning armies use a dashed line. A tile under incoming attack flashes red with a countdown.
- **Territory colors**: your land, allies', enemies' and other players' land each get a light tint, and only the outer edge of a whole region gets a border line, like national borders in Civilization 6. No more screens full of tiny boxes.
- **Output layer**: turn it on to see what each wild tile produces and how much per hour. Your own tiles also show a reserve bar that changes color as they run low. No need to click tile after tile.
- The map shows the armies of the city you are currently viewing, and switches when you switch cities.

**2. Tavern and Academy: main city only, shared by the whole account**

- Every city used to be able to build a Tavern and an Academy, but their effects were already account-wide (techs apply to the whole account; the hero cap uses the highest Tavern level among your cities), so extra copies in branch cities were wasted resources. These two buildings can now **only be built in your main city**. Branch cities no longer show them, and trying to build one tells you it is main-city only.
- Hiring heroes and researching techs always use the main city's Tavern and Academy, wherever you are standing.
- **Old data is handled automatically on upgrade:**
  - the highest Tavern and Academy level across your cities is merged into the main city, **with no downgrade**;
  - those buildings in branch cities are removed; anything being built or queued there is cancelled and **resources are refunded**;
  - hero candidates waiting in branch cities are cleared; just refresh at the main city's Tavern.
- When you swap your main city, the Tavern and Academy records swap with it, so no levels are lost.

**3. Infirmary: handle all cities in one click**

- With several cities you used to have to switch to each one to deal with its wounded, prisoners and deserters. The Infirmary now has:
  - **An "All cities" summary line**: the total wounded (or prisoners, deserters) across all cities, how many cities have some, and how long until the earliest batch expires (red under 6 hours).
  - **One-click buttons**: Heal all and Abandon all on the Wounded tab, Recruit all and Release all on the Prisoners tab, and Recall all on the Deserters tab. A confirmation lists one city per line with amounts and costs; after you confirm, cities are handled one by one, the earliest-expiring first, and you get a per-city result.
- Resources and population are **still per city**; nothing is pulled across cities. If one city cannot afford it, only that city fails (the result shows the shortfall) and the others carry on. A starving city is skipped by Recall all.
- **Red dot**: the Infirmary tab now lights up when the wounded, prisoners or deserters of any city have under 6 hours left, so no city is missed.

**Notes**

- There is a new read-only call for the account-wide Infirmary (protocol v88), for players and Agents alike. Building a Tavern or Academy in a branch city now returns a new error code. See the protocol docs for details.
- If you use slg-mcp, please upgrade to the latest version to get the new tool.
