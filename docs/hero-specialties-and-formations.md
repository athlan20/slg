# Ordinary hero specialties and troop formations

New ordinary heroes receive one uniformly random specialty when recruitment succeeds. It is stored on the hero and cannot be selected, changed, or reset. Tavern candidates do not reveal a specialty before hiring.

Famous heroes retain their existing attributes, growth, salaries, and combat bonuses. Existing ordinary heroes also keep their current behavior and have no specialty. Neither group is backfilled or rerolled.

## Specialty rules

| Specialty | Matching troops | Attack bonus | Damage reduction | Condition |
| --- | --- | ---: | ---: | --- |
| Infantry | Militia, pikemen, swordsmen | 2.5% | 2.5% | Matching troops only |
| Ranged | Archers, ballistae | 2.5% | 0% | Matching troops only |
| Cavalry | Light and heavy cavalry | 10% | 4% | Matching troops only |
| Siege | Ballistae, siege rams | 8% | 3% | Siege battles only |
| Assault | Combat troops | 3% | 0% | Excludes porters and supply wagons |
| Defense | Combat troops | 0% | 2.5% | Excludes porters and supply wagons |

Specialty percentages add to the hero's existing attack and damage-reduction percentages for matching stacks. World combat uses the existing command-dilution factor. Arena and star tower apply full specialty strength, matching their existing handling of hero bonuses. Siege specialty does not activate in these two field-battle modes.

The shared engine applies the rules to marches, wilderness encounters, NPC and player city attacks, yellow-turban battles, interception, and city defense. City defense uses the appointed guard and the actual garrison. Army losses, rewards, and hero experience still use the existing settlement paths.

## Formation choices

Arena and star tower share three saved slots. Each slot can independently choose balanced, infantry, ranged, or cavalry. Balanced preserves the previous army exactly. Other templates convert the standard army size into troop counts using the server's catalog and simulation-calibrated factors. These are temporary armies; template coefficients are not recruitment costs or stock limits.

World-map shortcuts fit the same troop proportions to available city stock. They leave surplus troops at home, never create troops, and allow manual edits before marching. They do not change the defending garrison or automatically send troops.

Formation previews and world shortcuts consume the authoritative catalog returned by the server. The UI shows actual preview counts, specialty effects, and round-level army results. Famous heroes can use formation choices without gaining a specialty.

## Compatibility and schema

Protocol v57 adds `specialty` and `specialtyBonus` to hero views, specialty information to combat snapshots, saved `formations` to arena/tower state, and a formation catalog to their rules.

`SET_ARENA_LINEUP` accepts an optional array of exactly three valid formation identifiers. Existing clients that omit it preserve their saved templates. New entries default to balanced. Historical reports without specialty/template fields display as no specialty and balanced.

The existing idempotent startup schema adds a nullable specialty column to `account_heroes` and a defaulted formations column to `arena_entries`. It does not rewrite existing hero attributes or delete data. No production database migration is performed by this change's local verification.

## Verification

Run from the repository root in PowerShell:

```powershell
npm --prefix backend run typecheck
npm --prefix backend test
npm --prefix backend run check:api-doc
npm --prefix backend run calibrate:specialties
npm --prefix frontend run typecheck
npm --prefix frontend run build
npm --prefix mcp run sync:manifest
npm --prefix mcp run typecheck
npm --prefix mcp test
npm --prefix mcp run build
git diff --check
```

All checks should exit successfully. The calibration command prints formation matchup rates and specialty effects using fixed seeds. The tests cover famous-hero invariance, immutable recruitment sampling, command dilution, city defense, legacy saves, deterministic replay, client/server preview equality, and real-stock selection limits.

Calibration uses equal attributes (lead/force/wit 50), 400 matches per pairing, and seeds 10000 through 10399. Rows are the attacking template; percentages are attacker wins:

| Attack / defense | Balanced | Infantry | Ranged | Cavalry |
| --- | ---: | ---: | ---: | ---: |
| Balanced | 50.5% | 48.0% | 53.0% | 48.0% |
| Infantry | 51.3% | 52.0% | 74.3% | 44.0% |
| Ranged | 48.0% | 28.0% | 50.2% | 58.5% |
| Cavalry | 52.5% | 57.0% | 30.3% | 42.3% |

Averaged over both seats, every template is 48-52% against balanced, and the three specialised templates form a cycle: infantry beats ranged (~73%), ranged beats cavalry (~64%), and cavalry beats infantry (~57%). Results are unchanged at lead 0 and lead 100. Troop counters are unchanged; only template shares and budgets were tuned.

The first-version cavalry template (60% light cavalry, 40% pikemen) lost to infantry 94.5% of the time. Light cavalry (speed 110 on a 120-long field) reaches the enemy in the first round while pikemen (speed 20) lag behind, and every unit targets the frontmost enemy stack, so the riders were destroyed alone before their escort arrived. With cavalry speed set to 20 in a test run the same template won 99.3%, while removing the pikeman ×1.2 counter changed nothing. The cavalry template now pairs a 30% cavalry share with archers that fire from range (budget 1.7), and infantry (1.2 → 1.25) and ranged (1.0 → 0.96) are re-centred on balanced.

Second-pass specialty parameters (table above) were cut after the first pass gave a single specialty a 65-77% win rate in an equal-army duel. Each specialty is measured with its matching template against the same army without a specialty, averaged over both seats (seeds 20000-20399): infantry 60.0%, ranged 59.1%, assault 58.9%, defense 59.4%. Cavalry keeps its first-version 10%/4%: the cavalry template has too few riders for this duel to measure it (50.9% at both 10% and 20%), so a larger value would only show up in all-cavalry world armies. Siege applies only in sieges and was scaled by judgment, not measured.

These are not evidence of balance across every attribute range or army composition. Later balancing should rerun the matrix and the existing world-combat calibration commands.

## Local verification result

The backend suite passed 397 tests. The MCP suite passed 18 tests, including local WebSocket transport, reconnect, protocol propagation, and optional formation parameters. Backend, frontend, and MCP typechecks passed; frontend and MCP builds passed; generated API documents and bundled manifests are synchronized.

An isolated component fixture verified formation selection/save, troop-count previews, stock-limited world presets, round-report expansion, famous-hero display, and Chinese/English rendering at desktop and 390-pixel widths. This does not replace live PostgreSQL/API/Worker end-to-end verification, which remains pending because no PostgreSQL instance is configured in this checkout.

The existing agent-models test also needed a one-character optional-chain correction to typecheck its nullable sanitizer result. Its original length assertion still checks the same behavior; production model handling is unchanged.
