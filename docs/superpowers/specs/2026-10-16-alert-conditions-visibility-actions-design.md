# Alert conditions, visibility, layout, and actions

Date: 2026-10-16

## Purpose and agreed scope

Extend Banner Channels with selected AlertTicker-Card features while keeping server-side rule evaluation and the shared channel sensor feed. Admins configure alerts in the sidebar; dashboard cards render those feeds for the logged-in Home Assistant user.

The agreed features are:

- Compare an entity's state or an optional attribute in the primary match and additional conditions.
- Add and remove any number of additional entity conditions, combined with AND or OR.
- Require the primary match in both modes, matching AlertTicker-Card's logic.
- Position secondary text below or to the right of the headline, matching AlertTicker-Card's arrangement.
- Select visibility for Everyone, Admins, Non-admins, or Specific users, with a selectable Home Assistant user list.
- Configure Double tap alongside Tap and Hold.

The user explicitly excluded “any state change” triggers. Event retention, dismiss controls, nested condition groups, additional comparison operators, and a separate secondary-entity feature are outside this change. Secondary positioning applies to the existing `subtext`, including values rendered through its existing templates.

The sibling `../AlertTicker-Card` checkout was clean and current when inspected, at commit `2c4210e`. It supplies the behavior reference, rather than an import or dependency. Preserve the existing attribution and MIT license.

## Architecture

Keep the existing responsibilities:

1. The sidebar builds and edits rule records, using the native pickers added earlier in this session.
2. The backend validates and stores rules, snapshots Home Assistant entity state and attributes, and evaluates active alerts.
3. Each channel sensor publishes all its active alerts, including visibility, secondary position, and action metadata.
4. Each dashboard card filters that feed using `hass.user`, then determines its display mode, rotation, counter, and available actions.

The shared feed remains useful to automations and other consumers. Visibility is a display preference, as explicitly agreed: it does not remove alert contents from the underlying sensor or provide per-user data access control. Sensor state continues to report the total active count; the dashboard counter reports the visible count.

Extend the existing modules and extract small shared condition or visibility helpers where that avoids duplicating rules. Do not restructure unrelated editor or runtime behavior.

## Rule records and compatibility

Keep `match` as the primary condition. It retains its existing entity or pattern selection, operator, value, and exclusions, with an optional `attribute` string.

Add these fields:

```json
{
  "conditions_logic": "and",
  "conditions": [
    {
      "entity_id": "climate.hallway",
      "attribute": "current_temperature",
      "operator": "above",
      "value": 80
    }
  ],
  "secondary_position": "right",
  "visibility": {
    "mode": "users",
    "user_ids": ["home-assistant-user-id"]
  },
  "double_tap_action": {
    "action": "more-info",
    "entity": "climate.hallway"
  }
}
```

Defaults are an empty additional-condition list, AND logic, secondary text below the headline, Everyone visibility, and no double-tap action. Omitted fields retain those defaults. Existing rule and channel IDs, ordering, channel tags, time windows, templates, icons, colors, and actions remain intact.

Read legacy `also` as one additional AND condition when `conditions` is absent. The sidebar opens it in the new list. When saved, write the new list and remove `also`. New `conditions`, including an explicitly empty list, take precedence over legacy `also`; never evaluate both. Support legacy records through a shared normalization path used by the editor/backend as appropriate, without requiring an immediate rewrite of storage or a storage-version change.

## State and attribute matching

Each condition has an entity, optional attribute, existing comparison operator, and comparison value. For the primary match, an entity pattern can still produce one slide per matching entity; its optional attribute applies to each candidate.

- A blank attribute compares the entity's state using current behavior.
- A selected attribute compares the corresponding value from the entity's attributes.
- The editor suggests the selected entity's attribute names through Home Assistant's native attribute selector where available, with a text fallback. For patterns, allow entering an attribute name without requiring a single sample entity.
- Attribute names are direct Home Assistant attribute keys. Nested object traversal is outside this scope.
- Missing entities, absent attributes, and null attribute values do not match, including for `is_not`. Preserve the existing explicit handling of `unknown` and `unavailable` state comparisons.
- Text comparisons use scalar text values. Represent booleans as lowercase `true` and `false`; numeric values use their ordinary text representation. Numeric operators accept finite numeric scalars or numeric text. Structured object/list values do not match.
- Keep existing template variables and `{state}` replacement semantics: `state` remains the matched entity's actual state. Selecting an attribute changes the comparison input, not existing template output.

Extend runtime snapshots with attributes without breaking existing two-argument `Snap` construction in tests or consumers. Watch every additional condition entity and all primary pattern candidates. Attribute-only updates must re-evaluate the feed, even if the entity's state string is unchanged.

## Additional-condition logic and editor

Replace the single “Also” checkbox/form with an “Additional conditions” section containing an Add condition button, removable condition rows, and a logic selector. Each row uses an entity picker and the same attribute/comparison controls as the primary match. No arbitrary row limit is imposed by the editor.

Evaluation is:

| Mode | Active when |
| --- | --- |
| No additional conditions | Primary matches and the time window permits it |
| AND | Primary matches, every additional condition matches, and the time window permits it |
| OR | Primary matches, at least one additional condition matches, and the time window permits it |

An empty additional-condition list passes in both modes. There is no nested grouping. For example, door open plus additional conditions “someone home” and “alarm disarmed,” with OR, means `door open AND (someone home OR alarm disarmed)`.

Validate each row and show errors next to the relevant entity, attribute, operator, or value. Reject malformed condition lists and unsupported logic values through the existing websocket save response. A partially entered row is an error, rather than silently dropped. Preserve unsaved edits when adding/removing rows, switching logic, receiving state updates, or loading native pickers.

## Secondary position

Add a per-alert “Secondary value position” selector with Below headline (default) and Right of headline. Carry the selected position into the evaluated slide and both backend/frontend feed signatures, so edits update existing cards.

In Below mode, keep the current severity/headline/subtext stack. In Right mode, severity occupies its own row, and the headline and secondary text share the row below it, with the secondary text on the right. The headline can shrink; the secondary value retains its space where possible. Constrain both within narrow cards to avoid horizontal overflow or covering the icon or counter. Keep existing font sizes, card height, alignment, colors, and severity styling.

Apply the same arrangement to the sidebar preview. An empty secondary value occupies no space in either mode. Left and center card alignment remain supported.

## User visibility

Store `visibility.mode` as `all`, `admin`, `non_admin`, or `users`. Only `users` uses `user_ids`; normalize IDs by trimming and deduplicating them. Missing visibility means `all`. Reject unsupported modes, malformed ID lists, and Specific users with no selected IDs on save.

When Specific users is selected, fetch Home Assistant users with the existing `config/auth/list` websocket command, as AlertTicker-Card does. The sidebar is already admin-only. Display active, non-system users by display name in a selectable checkbox list, sorted by name. Save stable IDs, not names. Duplicate names must be distinguishable in the list. Loading and request failure have explicit states and a retry control; do not substitute typed user names or silently switch to Everyone. Preserve selections and unsaved edits across asynchronous loading. Previously selected IDs that are no longer available remain visible as unavailable selections and can be removed.

At display time:

- Everyone always passes.
- Admins requires `hass.user.is_admin === true`.
- Non-admins requires a known user with `is_admin === false`.
- Specific users requires the current `hass.user.id` to appear in `user_ids`.
- Restricted alerts remain hidden until user identity is available. Unknown visibility metadata also stays hidden.

Filter before computing hide/all-clear mode, rotation length/index, slide counter, or action targets. If no alerts are visible, use the channel's configured hide/all-clear behavior even when the sensor's total active count is positive. Recompute when the current user's identity or admin status changes, including when the sensor feed does not change. Keep the same visible slide by ID when possible; otherwise reset safely to an existing visible slide.

Visibility metadata travels on each evaluated alert and participates in feed change detection. Do not include the user directory or display names in the sensor feed.

## Double-tap actions

Add Double tap to the sidebar using the same action editor, entity/service pickers, validation, and serialization as Tap/Hold. Support the existing six action types. Default to no action. Resolve blank Toggle/More-info entities to the matched entity on the backend, including pattern-generated slides.

Add `double_tap_action` to the evaluated feed and signatures. The card distinguishes tap, double tap, and hold:

- Without an enabled double-tap action, preserve immediate single-tap behavior.
- With a double-tap action, wait 250 ms after the first completed tap. A second tap on the same alert during that window cancels the pending single tap and executes the double-tap action once.
- Keep the existing 500 ms hold threshold and movement cancellation. A hold never also executes tap or double tap.
- Capture the pressed alert's identity and action rather than looking up a later rotation index. Cancel pending gestures when their alert disappears, becomes hidden, the configuration changes, or the card disconnects.
- Clear timers on cancellation/disconnection and keep separate interactions on different alerts from combining into a double tap.

## Validation and verification

Backend tests cover primary and extra attribute matching, missing/null/structured values, scalar conversion, numeric boundaries, AND/OR truth tables, no-extra-condition behavior, legacy `also`, malformed payloads, attribute-only runtime updates, watched entities, new feed fields/signatures, and double-tap action resolution.

Frontend tests cover condition add/remove/edit/save/reopen, legacy editing, picker dependencies, visibility user-list loading/failure/retry, stable IDs across renames, unavailable selections, visibility modes and unknown users, filtered rotation/counters/empty states, sidebar preview and card markup for both positions, and deterministic gesture timing including rotation and cancellation.

Run the full JavaScript and Home Assistant Python suites. Perform a browser/layout check for both secondary positions at narrow and wide card widths. Live Home Assistant verification should cover native attribute/user controls, admin/non-admin/specific-user dashboard views, attribute-only changes, old saved rules, and mouse/touch gesture behavior. Report separately which checks were automated and which were exercised in a live instance.

Update README examples and editor help for all new fields and the distinction between primary matching and additional AND/OR conditions. Keep the previously implemented native-picker work intact. This design approval does not request deployment or a new release.
