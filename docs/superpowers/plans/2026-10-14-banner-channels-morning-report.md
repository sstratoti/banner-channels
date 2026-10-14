# Banner Channels morning report

Branch `banner-channels` in the worktree `/home/steve/Documents/GitHub/alert-ticker-lite-card/.worktrees/banner-channels`. Head after this report is the commit that adds this file. Production Home Assistant was not modified. Nothing was copied into the config, and no container was restarted.

The main checkout still has the older untracked copies of the spec and plans, plus a one-line `.gitignore` change so `.worktrees/` stays untracked. The checked-off plans are on this branch.

## Tests

At `be7bad9`, before this report: `pytest` 35 passed, `node --test` 10 passed.

The local card harness was clicked. Three alerts rotated and the badge showed 3. Hide set `display: none`. All clear showed its text and a click did not log more-info. Unavailable showed `Banner unavailable`. A click on Basement leak logged `more-info → binary_sensor.basement_leak`. A drag past 10 pixels was not tried. The harness icon stub prints the `mdi:` name because it is not Home Assistant's icon element.

## What landed

| Task | Commits | Result |
| --- | --- | --- |
| Docs | `7efa36c` | Spec, plans, and runbook |
| E1 operators and windows | `d82547f`, `9e7d39d` | 3 evaluate tests, then later growth |
| E2 feeds | `4433dfb`, `78ead71`, `2a222e0`, `446ac29` | Order, signature, and skip tests added after review |
| E3 validation | `817a1f9`, `d2cc117`, `aca8694` | Non-finite values and service data locked. Combined suite grew past the plan's `19 passed` |
| C1 card decisions | `ff0b894`, `83a13d8`, `8309f48` | Five banner-core tests, with extra assertions |
| C2 card element | `9cf226b`, `65e1380` | Lite card files removed. `hacs.json` is Banner Channels, Home Assistant `2026.10.0`, no Lovelace filename |
| I1 unchanged feeds | `576396f`, `e97adc6` | |
| I2 sensors | `6dfabc5` | Install step left unchecked |
| I2b runtime test | `b1ce876` | Passed on the test harness's Home Assistant 2026.2.3, not 2026.10 |
| I3 sidebar | `ff0fd79` | Help text is in the panel. Live dashboard check left unchecked |
| I4 README | `202f92a` | Install and Use sections. Node-RED example removed |
| Late filter matches | `be7bad9` | A battery sensor that appears after startup is picked up |

Checkmarks and short hashes are on the plan steps. Two steps are still open, both yours: install the integration, and verify the sidebar on a dashboard.

## Install, when you want it

Copy `custom_components/banner_channels` from the worktree into Home Assistant's `custom_components` directory and restart Home Assistant yourself. Add Banner Channels once from Settings, Devices & services. I did not do that.

Do not install until you answer the card-element question below. As written, a dashboard card of type `custom:banner-channel` will not find its element.

## Questions

1. **Models.** The dispatch list had no `grok-4.7-low` and no Composer slug without `fast`. Every implementer and reviewer ran on `grok-4.7-high`. `composer-2.5-fast` was not used. The work is otherwise finished, so this only matters if you want a different model for follow-up fixes.

2. **Card element name.** The spec says the card type is `custom:banner-channel` and the element is `banner-channel-card`. Lovelace looks up `banner-channel`. The harness creates `banner-channel-card` directly, so the click test stayed green. I did not rename it. Defining the same class as both names would make the dashboard card load and keep the spec's element name. Say if you want that.

3. **A rule aimed at a Banner Channels sensor can flap.** The spec allows an explicit entity match of our own channel sensor, and filter matches skip those sensors. If a rule matches `sensor.banner_tablets` being `0`, the sensor becomes `1`, the rule clears, and it writes `0` again. I did not change that, because the spec allows the explicit match. Say if the editor should reject a match against our own sensors.

4. **Non-finite compare test.** The plan's `compare("nan", "below", "1")` still passes if the non-finite guard is deleted, because `float("nan") < 1` is already false. Validator tests now reject `inf` and `nan` on the form. The compare function's own `inf` case is still untested. Say if you want that assertion added.

5. **Runtime test Home Assistant.** `pytest-homeassistant-custom-component` loaded Home Assistant 2026.2.3. The product floor is 2026.10.0. Frontend setup is stubbed in that test because the harness has no `hass_frontend`.

6. **Sidebar leftovers.** Delete uses `record_id` because Home Assistant already uses `id` for the websocket message. A cleared color still shows `#000000` in the color input; the hex field and the preview stay empty. Entity ids are typed, not chosen with `ha-entity-picker`.
