# Alert Conditions, Visibility, Layout, and Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add attribute comparisons, additional AND/OR conditions, secondary positioning, per-user display visibility, and double-tap actions while preserving existing alerts.

**Architecture:** Keep evaluation on the backend and publish a shared sensor feed with display/action metadata. The sidebar edits compatible rule records; dashboard cards filter alerts for the current user before rendering or responding to gestures. Extend existing modules with focused helpers, preserving the native-picker changes already in the working tree.

**Tech Stack:** Python/Home Assistant, vanilla JavaScript custom elements, Home Assistant's Lit/native controls, pytest, Node test runner, happy-dom.

**Spec:** `docs/superpowers/specs/2026-10-16-alert-conditions-visibility-actions-design.md`

## Global Constraints

- Require the primary match in both modes, matching AlertTicker-Card's logic.
- The user explicitly excluded “any state change” triggers.
- Secondary positioning applies to the existing `subtext`, including values rendered through its existing templates.
- Visibility is a display preference; sensor state continues to report the total active count and dashboard counters report the visible count.
- Defaults: empty additional conditions, AND logic, secondary below, Everyone visibility, no double-tap action.
- New `conditions`, including an explicitly empty list, take precedence over legacy `also`; never evaluate both.
- Save stable user IDs, not names. Keep the native-picker work and existing MIT attribution intact.
- Preserve the existing 500 ms hold threshold; use a 250 ms double-tap window.
- No deployment, release/version change, new runtime dependency, nested condition groups, or secondary-entity feature.

## Review Focus

- A malformed websocket payload must return field errors without crashing or replacing a valid saved alert (Task 1).
- Missing/null/structured attributes must not accidentally satisfy an inequality; zero and false must remain usable values (Task 2).
- A user-list response arriving after navigation must not overwrite another draft; duplicate names/deleted users must remain distinguishable (Task 4).
- Switching dashboard identity while the sensor feed is unchanged must update hidden alerts, counters, and pending interactions (Tasks 5–6).
- Rotation between pointer-down and release, or during the double-tap window, must never execute an action belonging to a different alert (Task 6).

## File responsibilities and execution context

| File | Responsibility |
| --- | --- |
| `custom_components/banner_channels/validate.py` | Rule normalization and payload validation |
| `custom_components/banner_channels/__init__.py` | Preserve and validate new fields in websocket saves |
| `custom_components/banner_channels/evaluate.py` | State/attribute comparisons, extra-condition logic, slide metadata/signatures |
| `custom_components/banner_channels/runtime.py` | Snapshot attributes and watch all condition entities |
| `custom_components/banner_channels/frontend/banner-channels-panel.js` | Drafts, records, condition controls, user checklist, preview/actions |
| `custom_components/banner_channels/frontend/banner-core.js` | Visibility/filter helpers and feed signatures |
| `custom_components/banner_channels/frontend/banner-channel-card.js` | Filtered display, secondary layout, gesture lifecycle |
| `tests/test_validate.py`, `tests/test_websocket.py`, `tests/test_evaluate.py`, `tests/test_runtime.py` | Backend behavior and integration contracts |
| `test/banner-panel.test.mjs`, `test/banner-panel-ui.test.mjs`, `test/banner-core.test.mjs` | Editor and pure frontend behavior |
| `test/banner-card-ui.test.mjs` (new) | Real card class rendered with a minimal Lit host and controlled HA boundary |
| `README.md`, `test/harness.html` | User examples and repeatable layout checks |

Existing native-picker changes are uncommitted: the panel, README, package.json, lockfile, and panel UI tests. Establish their baseline and preserve them; do not reset them or silently include them in an unrelated task commit. At execution time follow the worktree skill and the user's workspace preference. If using a new worktree, carry these authorized changes over explicitly before testing. Do not create another worktree inside the existing `.worktrees/banner-channels` checkout or reuse its branch as the implementation branch.

After baseline verification, commit the previously reviewed native-picker work separately as `feat: use native Home Assistant editor pickers`, explicitly staging only its five files. Subsequent task commits then remain focused.

For Python commands, use `PY=.worktrees/banner-channels/.venv/bin/python` from the current root when that environment remains available, otherwise use a configured environment with `requirements-test.txt`. This is a command shorthand, not a change to application configuration. Baseline commands: `npm test` and `$PY -m pytest -q`. Both passed in the preceding picker work; recheck at execution start. No tests are required for this planning-only commit.

### Task 1: Compatible rule records and validation

**Files:** Modify `validate.py`, `__init__.py`; test `tests/test_validate.py`, `tests/test_websocket.py`.

**Interfaces:** Produce `normalize_rule_options(data: dict) -> dict` in `validate.py`, returning a copy with canonical `conditions`, `conditions_logic`, `secondary_position`, and `visibility` defaults and no legacy `also`. Preserve malformed values for `validate_rule(data: dict) -> dict[str, str]` to report; normalize valid user ID lists by trim/deduplication. `_prepare_rule(hass, runtime, record)` keeps its existing `(record_or_none, errors)` interface and preserves `double_tap_action`.

- [ ] **Write failing tests:** `test_rule_options_normalize_legacy_and_defaults` asserts legacy `also` becomes one AND row, explicit `conditions: []` wins over `also`, and omitted options become `[]`, `and`, `below`, `{"mode": "all"}`. `test_rule_options_reject_malformed_payloads` covers non-list conditions, non-object rows, invalid logic/position/visibility, invalid attribute types, non-string user IDs, and empty users selection. Assert indexed errors such as `conditions_0_entity`, `conditions_0_operator`, and `conditions_0_value`. `test_save_round_trips_rule_options_and_rejects_invalid_double_tap` sends real websocket saves and asserts invalid payloads leave the existing rule intact.
- [ ] **Verify red:** Run `$PY -m pytest tests/test_validate.py tests/test_websocket.py -q`; confirm the new assertions fail for missing behavior.
- [ ] **Implement:** Validate conditions using the existing comparison operators; trim optional attribute keys and reject non-string keys. Allow visibility modes `all`, `admin`, `non_admin`, `users`; require a nonempty list for `users`. Normalize before preparing/saving records, preserve canonical fields, and apply existing action validation to double tap. Reject bad container types through field errors. Retain legacy `also_*` errors when necessary for existing direct validation tests; use indexed errors for new condition rows.
- [ ] **Verify green:** Run the targeted suites and then `$PY -m pytest -q`. Existing websocket admin checks, IDs, ordering, and template validation must remain green.
- [ ] **Commit:** Stage only this task's Python files/tests; commit `feat: validate compatible alert options`.

### Task 2: Attribute evaluation, condition groups, and feed metadata

**Files:** Modify `evaluate.py`, `runtime.py`; test `tests/test_evaluate.py`, `tests/test_runtime.py`.

**Interfaces:** Extend `Snap(state: str, name: str, attributes: dict | None = None)` while retaining two-argument construction. Add `_condition_value(snap: Snap, condition: dict) -> str | None` and `_extra_conditions(rule: dict) -> list[dict]` in `evaluate.py`. Keep `evaluate(...)`, `watched_entity_ids(...)`, and `feed_signature(...)` signatures. Emit optional `secondary_position`, `visibility`, and `double_tap_action` on slides, using spec defaults when omitted. Use Task 1's canonical fields; accept legacy `also` in unsaved stored rules.

- [ ] **Write failing tests:** `test_attribute_comparison_preserves_zero_false_and_missing_values` asserts zero compares to `"0"`, false to `"false"`, and absent/null/list/object attributes fail `is_not`. `test_primary_is_required_with_and_or_extras` uses a table of primary/extra booleans and proves `primary AND all(extras)` or `primary AND any(extras)`, with empty extras passing. Cover primary patterns, legacy `also`, finite numeric comparisons, and unchanged `{state}` output. `test_feed_metadata_and_signatures_include_new_options` changes each new field independently and asserts a changed signature. `test_attribute_only_updates_and_additional_entities_refresh_feed` changes an attribute with the state string unchanged, then changes a third condition entity, and asserts the sensor updates both times.
- [ ] **Verify red:** Run `$PY -m pytest tests/test_evaluate.py tests/test_runtime.py -q` and inspect the expected failing cases.
- [ ] **Implement:** Read direct attribute keys, normalize scalar comparison values, and preserve current state/offline checks. Evaluate additional conditions before emitting primary candidates. Include all additional entity IDs in watches and pass `state.attributes` into snapshots. Carry all new slide metadata and resolve double-tap Toggle/More-info entities using the primary candidate. Include new fields in backend feed signatures.
- [ ] **Verify green:** Run the targeted suites and `$PY -m pytest -q`. Existing two-argument snapshots and feed ordering remain valid.
- [ ] **Commit:** Stage this task's files/tests; commit `feat: evaluate entity attributes and extra conditions`.

### Task 3: Sidebar attributes and additional-condition list

**Files:** Modify `frontend/banner-channels-panel.js`; test `test/banner-panel.test.mjs`, `test/banner-panel-ui.test.mjs`.

**Interfaces:** `ruleDraft(record)` gains `match.attribute`, `conditions` rows shaped `{entity_id, attribute, operator, value}`, and `conditions_logic`. `ruleRecord(draft)` serializes those fields and omits `also`. Preserve the existing draft/record interfaces and all other fields. Attribute controls use selector `{attribute: {entity_id: selectedEntity}}` where supported, with a text fallback for patterns or missing native components.

- [ ] **Write failing tests:** `additional conditions add remove save and reopen without losing draft edits` adds three rows, removes the middle row, selects OR, and asserts saved order/values and reopened state. `legacy also opens as one AND condition and is saved canonically` asserts existing values survive. `attribute selection follows its entity and survives picker loading` changes the entity, verifies the selector's entity reference, and asserts entered attribute names and unrelated headline/action edits survive asynchronous picker loading. Verify row-specific validation errors render beside the correct row.
- [ ] **Verify red:** Run `node test/banner-panel.test.mjs` and `node test/banner-panel-ui.test.mjs`; confirm failures come from the missing controls/serialization.
- [ ] **Implement:** Replace `_alsoFields` with `_conditionsFields(draft, errors)`, add an attribute-control helper shared with `_matchFields`, and preserve full draft state across structural renders. Use Add condition/Remove controls and label the group logic `AND — all must match` / `OR — at least one must match`. Update help to make primary-required semantics explicit. Do not introduce new operators or change `{state}` template meaning.
- [ ] **Verify green:** Run both files directly and `npm test`. Update old panel tests to use the new public behavior while retaining legacy-record coverage.
- [ ] **Commit:** Stage the panel and its tests only after explicitly accounting for the earlier native-picker edits; commit `feat: edit attribute and additional alert conditions`.

### Task 4: Sidebar visibility, secondary position, and Double tap

**Files:** Modify `frontend/banner-channels-panel.js`; test `test/banner-panel.test.mjs`, `test/banner-panel-ui.test.mjs`; document new rule options in `README.md`.

**Interfaces:** Drafts and `ruleRecord` round-trip `visibility: {mode, user_ids?}`, `secondary_position: "below" | "right"`, and `double_tap_action` using the existing action draft/record helpers. Add `_loadUsers() -> Promise<void>` and `_visibilityFields(draft, errors) -> HTMLElement`; maintain panel-level cached user data/loading/error state separate from drafts. Users come from `hass.callWS({type: "config/auth/list"})`.

- [ ] **Write failing tests:** `specific users displays names and saves stable selected IDs` supplies active, inactive, system, renamed, and duplicate-name fixtures; assert only eligible users are offered, duplicate names are distinguishable, and IDs survive reopening/renaming. `user loading retries without changing visibility or another draft` rejects once, retries successfully, navigates during a pending response, and asserts no draft replacement. `removed users remain selectable for removal and empty selection blocks save` checks unavailable stored IDs. `secondary position and double tap round trip and preview` asserts right layout, unchanged below default, action picker values, invalid service JSON errors, and blank entity fallback preservation.
- [ ] **Verify red:** Run the panel test files directly and inspect the newly failing cases.
- [ ] **Implement:** Render Everyone/Admins/Non-admins/Specific users plus the checkbox list, sorted by display name; use ID suffixes to distinguish duplicates. Cache the directory separately, show loading/error/retry, preserve unavailable selections, and check draft identity before updating any view after an awaited fetch. Add Double tap with `_actionFields` and a per-alert secondary-position selector; update `_preview` layout accordingly. Add README examples with stable IDs and primary-required logic.
- [ ] **Verify green:** Run panel suites and `npm test`. Check the existing native icon template and service target tests still pass.
- [ ] **Commit:** Stage this task's panel/tests/docs changes; commit `feat: configure alert visibility layout and double tap`.

### Task 5: Filtered dashboard feeds and secondary positioning

**Files:** Modify `frontend/banner-core.js`, `frontend/banner-channel-card.js`, `package.json`, `package-lock.json`; test `test/banner-core.test.mjs`; create `test/banner-card-ui.test.mjs`; extend `test/harness.html` and README display documentation.

**Interfaces:** Export `alertVisible(alert, user) -> boolean` and `visibleFeed(attributes, user) -> object` from `banner-core.js`. `visibleFeed` returns a shallow feed copy whose `alerts` are filtered, without mutating sensor data. The card stores this filtered feed in `_attrs` and uses it consistently for view mode, rendering, rotation, counter, and action lookup. Extend `feedSignature` for visibility, position, and double tap. For card tests, install `lit` as a development dependency only. Register an HA host extending the real `LitElement` with its `html` and `css` helpers exposed as the card expects, then import the real card in happy-dom. Mock only HA inputs and service calls; do not replace the card or its rendering methods. Establish DOM globals before importing Lit, and isolate module/registry state between cases.

- [ ] **Write failing tests:** `visibility modes hide restricted alerts until identity is known` asserts all/admin/non-admin/users/invalid modes and uses literal user IDs. `visible feed does not mutate shared attributes` proves the original total is unchanged. `card identity changes recompute counters and empty mode with unchanged sensor` switches identities, exercises both hide and all-clear, and asserts the visible slide is retained by ID where possible. `secondary position renders severity above headline and right value` checks real card DOM for below/right/empty values under left and center alignment. Assert each new metadata field affects signatures independently.
- [ ] **Verify red:** Run `node test/banner-core.test.mjs` and `node test/banner-card-ui.test.mjs` and confirm expected missing behavior.
- [ ] **Implement:** Filter on every `hass` assignment using `hass.user`, preserve raw sensor availability, and use visible alerts for all lengths/indexes. Preserve an existing visible alert by ID where possible, otherwise reset to a valid visible slide. Expose `this._currentAlert() -> object | undefined` on the card for Task 6. Implement Below/Right rows with constrained widths and a separate severity row; retain card font/size/color settings and counter placement. Update harness examples for wide/narrow cards, long secondary text, and user identity changes.
- [ ] **Verify green:** Run core/card UI tests and `npm test`. Use a browser to inspect the harness at narrow/wide widths and confirm no icon/counter overlap; if browser tooling is unavailable, report that check as unperformed rather than claiming visual verification.
- [ ] **Commit:** Stage task files/tests/docs; commit `feat: filter dashboard alerts and position secondary text`.

### Task 6: Gesture timing, cancellation, and final integration verification

**Files:** Modify `frontend/banner-channel-card.js`; test `test/banner-card-ui.test.mjs`; update README interaction notes.

**Interfaces:** Consume Task 5's `this._currentAlert()`. Change `_runAction(kind, alert)` to execute the captured alert's `tap_action`, `hold_action`, or `double_tap_action`. Add `_cancelPendingTap() -> void`; keep pointer/hold cleanup separate from pending single-tap cleanup. Clear pending gestures on disconnect/configuration change and whenever the captured alert disappears or becomes invisible.

- [ ] **Write failing tests:** With controlled timers, assert `tap without double action runs immediately`, `single tap with double action runs after 250 ms`, `two taps execute only double tap`, and `hold at 500 ms executes only hold`. Add movement/pointercancel/disconnect/config-change cases. `rotation between press and release uses captured alert action` changes the index mid-press and asserts the first alert's service/entity is used. `identity change cancels actions for newly hidden alert` changes users during the pending tap. Taps on different alert IDs must not combine; no action executes twice.
- [ ] **Verify red:** Run `node test/banner-card-ui.test.mjs` and inspect failures against the immediate-tap implementation.
- [ ] **Implement:** Capture alert ID and action data at press, distinguish same-alert taps inside 250 ms, retain the 500 ms hold/movement behavior, and cancel pending actions on lifecycle/visibility changes. Treat absent or `none` double-tap configuration as immediate-tap mode. Keep action execution routed through existing `performAction`, using only captured data.
- [ ] **Verify green:** Run the card UI suite, `npm test`, `$PY -m pytest -q`, and `git diff --check`. Obtain one fresh whole-change review, resolve substantive findings, and rerun only tests justified by fixes.
- [ ] **Document and commit:** Record interaction timing and the display-only visibility behavior in README. Commit `feat: support double-tap alert actions` with this task's files. Report automated counts and any unperformed live HA checks. No push, release, or deployment is included.

## Final acceptance checks

- Existing stored rules, including `also`, retain matching/display behavior and reopen without lost settings.
- State/attribute conditions and all additional rows are editable with native suggestions and useful save errors.
- The primary match stays required in OR mode; empty extras pass in both modes.
- Secondary Below/Right layout agrees between sidebar preview and dashboard, with no narrow-card overflow.
- User names are selectable, IDs are stored, and filtered display/count/rotation respond to account changes.
- Tap, Double tap, and Hold have exclusive execution and never target a rotated-in alert accidentally.
- Full automated suites pass. Live HA checks are explicitly identified as performed or still pending.

## Recommended execution

Use Native execution in this session: the six tasks share record and feed interfaces, so one implementer can keep them consistent efficiently. Finish with one independent whole-change review. The user must review this plan and choose Native or Subagent-driven execution before implementation, as required by the planning skill.
