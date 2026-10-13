# Ordinary hero specialties and troop formations

New ordinary heroes receive one uniformly random specialty when recruitment succeeds. It is stored on the hero and cannot be selected, changed, or reset. Tavern candidates do not reveal a specialty before hiring.

Famous heroes retain their existing attributes, growth, salaries, and combat bonuses. Existing ordinary heroes also keep their current behavior and have no specialty. Neither group is backfilled or rerolled.

## Specialty rules

| Specialty | Matching troops | Attack bonus | Damage reduction | Condition |
| --- | --- | ---: | ---: | --- |
| Infantry | Militia, pikemen, swordsmen | 8% | 8% | Matching troops only |
| Ranged | Archers, ballistae | 12% | 0% | Matching troops only |
| Cavalry | Light and heavy cavalry | 10% | 4% | Matching troops only |
| Siege | Ballistae, siege rams | 18% | 8% | Siege battles only |
| Assault | Combat troops | 6% | 0% | Excludes porters and supply wagons |
| Defense | Combat troops | 0% | 6% | Excludes porters and supply wagons |

Specialty percentages add to the hero's existing attack and damage-reduction percentages for matching stacks. World combat uses the existing command-dilution factor. Arena and star tower apply full specialty strength, matching their existing handling of hero bonuses. Siege specialty does not activate in these two field-battle modes.

The shared engine applies the rules to marches, wilderness encounters, NPC and player city attacks, yellow-turban battles, interception, and city defense. City defense uses the appointed guard and the actual garrison. Army losses, rewards, and hero experience still use the existing settlement paths.

## Formation choices

Arena and star tower share three saved slots. Each slot can independently choose balanced, infantry, ranged, or cavalry. Balanced preserves the previous army exactly. Other templates convert the standard army size into troop counts using the server's catalog and simulation-calibrated factors. These are temporary armies; template coefficients are not recruitment costs or stock limits.

World-map shortcuts fit the same troop proportions to available city stock. They leave surplus troops at home, never create troops, and allow manual edits before marching. They do not change the defending garrison or automatically send troops.

Formation previews and world shortcuts consume the authoritative catalog returned by the server. The UI shows actual preview counts, specialty effects, and round-level army results. Famous heroes can use formation choices without gaining a specialty.

## Compatibility and schema

Protocol v56 adds `specialty` and `specialtyBonus` to hero views, specialty information to combat snapshots, saved `formations` to arena/tower state, and a formation catalog to their rules.

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

Initial calibration uses equal attributes (lead/force/wit 50), 400 matches per formation pairing, and seeds 10000 through 10399. Rows are the attacking template; percentages are attacker wins:

| Attack / defense | Balanced | Infantry | Ranged | Cavalry |
| --- | ---: | ---: | ---: | ---: |
| Balanced | 50.5% | 63.8% | 35.3% | 47.5% |
| Infantry | 32.5% | 52.0% | 45.8% | 94.5% |
| Ranged | 62.8% | 51.8% | 50.2% | 38.8% |
| Cavalry | 54.0% | 5.3% | 63.5% | 50.2% |

These are first-version parameters, not evidence of balance across every attribute range or army composition. Infantry's strong anti-cavalry matchup is intentional. Later balancing should rerun the matrix and the existing world-combat calibration commands.

## Local verification result

The backend suite passed 397 tests. The MCP suite passed 18 tests, including local WebSocket transport, reconnect, protocol propagation, and optional formation parameters. Backend, frontend, and MCP typechecks passed; frontend and MCP builds passed; generated API documents and bundled manifests are synchronized.

An isolated component fixture verified formation selection/save, troop-count previews, stock-limited world presets, round-report expansion, famous-hero display, and Chinese/English rendering at desktop and 390-pixel widths. This does not replace live PostgreSQL/API/Worker end-to-end verification, which remains pending because no PostgreSQL instance is configured in this checkout.

The existing agent-models test also needed a one-character optional-chain correction to typecheck its nullable sanitizer result. Its original length assertion still checks the same behavior; production model handling is unchanged.
