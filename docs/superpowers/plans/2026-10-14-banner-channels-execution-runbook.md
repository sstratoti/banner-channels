# Banner Channels execution runbook

> **For the coordinator:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Start on a session whose model is Grok 4.7 High (`grok-4.7-high`). Do not implement product code in that session.

**Goal:** Build Banner Channels from the three plans. Grok 4.7 High coordinates and reviews. Grok 4.7 Low and Composer execute. No fast model.

**Spec:** `docs/superpowers/specs/2026-10-13-banner-channels-design.md`

**Plans, in order:**

1. `docs/superpowers/plans/2026-10-13-banner-channels-evaluator.md`
2. `docs/superpowers/plans/2026-10-13-banner-channel-card.md`
3. `docs/superpowers/plans/2026-10-13-banner-channels-integration.md`

The card plan does not import the evaluator. Run it second anyway. Both plans create files under `custom_components/banner_channels/`, and the integration plan edits `evaluate.py` after the evaluator plan. One implementer at a time.

## Roles

| Role | Model | Slug | Does |
| --- | --- | --- | --- |
| Coordinator and every reviewer | Grok 4.7 High | `grok-4.7-high` | Reads this runbook, extracts one task brief, dispatches, reviews, keeps the ledger |
| Implementer and fixer, transcription tasks | Grok 4.7 Low | `grok-4.7-low` | Writes the task whose plan already contains the code, runs its tests, commits, self-reviews |
| Implementer and fixer, integration tasks | Composer | the Composer slug whose name does not contain `fast` | Writes the multi-file Home Assistant and card-element tasks, runs their tests, commits, self-reviews |

Never pass a slug that contains `fast`. That includes `composer-2.5-fast` and `cursor-grok-4.6-high-fast`. If `grok-4.7-low` or the non-fast Composer slug is rejected, stop and show Steve the allowed list. Do not substitute a fast model.

Pass `model` on every Task dispatch. An omitted model inherits the coordinator, which would bill Grok 4.7 High for implementation work.

Subagent type for implementers, fixers, and reviewers: `generalPurpose`. Environment: `local`. One implementer or fixer at a time. A reviewer starts only after that implementer has finished.

## Workspace

Use superpowers:using-git-worktrees before Task 1.

- Branch: `banner-channels`
- Never implement on `main`.
- The spec, the three plans, and this runbook are untracked on `main` until the coordinator commits them. A worktree from `HEAD` does not contain them. First commit on `banner-channels`, before any implementer: those five docs, message `docs: add Banner Channels spec, plans, and execution runbook`.
- Ledger: `.superpowers/sdd/progress.md` (gitignored). After a review comes back clean, append `Task <plan> <N>: complete (<base7>..<head7>, review clean)`. After compaction, trust the ledger and `git log`. Do not re-dispatch a task the ledger marks complete.
- Record the merge-base SHA before Task 1. That SHA is the base for the final review package.

## Task order

| ID | Plan task | Implementer | Implementer verifies | Reviewer |
| --- | --- | --- | --- | --- |
| E1 | Evaluator Task 1: Operators and time windows | `grok-4.7-low` | `python -m pytest tests/test_evaluate.py -q` → `3 passed` | `grok-4.7-high` |
| E2 | Evaluator Task 2: Build a channel feed | `grok-4.7-low` | `python -m pytest tests/test_evaluate.py -q` → `12 passed` | `grok-4.7-high` |
| E3 | Evaluator Task 3: Validate editor payloads | `grok-4.7-low` | `python -m pytest tests/test_validate.py tests/test_evaluate.py -q` → `19 passed` | `grok-4.7-high` |
| C1 | Card Task 1: Pure feed decisions | `grok-4.7-low` | `node --test test/banner-core.test.mjs` → `# fail 0`, five tests | `grok-4.7-high` |
| C2 | Card Task 2: Card element | Composer, non-fast | `node --test` → `# fail 0`, five `banner-core` tests, `ticker-core` gone | `grok-4.7-high` |
| I1 | Integration Task 1: Skip unchanged feeds | `grok-4.7-low` | `python -m pytest tests/test_evaluate.py -q` → `13 passed` | `grok-4.7-high` |
| I2 | Integration Task 2: Config entry, storage, and sensors | Composer, non-fast | Package imports and the commit in the plan. Steve installs it into Home Assistant. | `grok-4.7-high` |
| I2b | Integration Task 2b: Runtime test | Composer, non-fast | `python -m pytest tests/test_runtime.py -q` → `1 passed` | `grok-4.7-high` |
| I3 | Integration Task 3: Sidebar editor | Composer, non-fast | Panel files and the commit. Steve checks the sidebar after installing. | `grok-4.7-high` |
| I4 | Integration Task 4: Docs and HACS metadata | `grok-4.7-low` | `python -m pytest -q && node --test` green | `grok-4.7-high` |

Each implementer also follows that task's red step. The counts above are the green bars.

## Tests

Every new behavior lands with a test that fails when that behavior is removed. The test names the behavior in its title and asserts the values a later edit would get wrong: the operator result, the slide id, the feed order, the signature skip, the validation error key, the view mode, the action choice. A test that only checks that a call returns or that a file imports is not enough.

The plan's test list is the starting set. If a step adds a branch the plan's tests do not reach, add a test for that branch in the same step. Keep pure decisions in the modules those tests import (`evaluate.py`, `validate.py`, `banner-core.js`) so a UI change still has a regression net.

Run the relevant suite after every file-changing step, before the next step and before that step's commit:

| Once this exists | Run before the next step |
| --- | --- |
| `tests/test_evaluate.py` only | `python -m pytest tests/test_evaluate.py -q` |
| `tests/test_validate.py` too | `python -m pytest tests/test_validate.py tests/test_evaluate.py -q` |
| `test/banner-core.test.mjs` | `node --test test/banner-core.test.mjs` |
| Both Python and the card tests | `python -m pytest -q && node --test` |

A previously passing test that fails stops the step. Fix it, re-run the suite, then commit. The implementer report includes the command and the output for each between-step run. A report missing that output is not `DONE`.

The failing-test commit may fail only the new test. Every test that already passed still passes in that commit. The following commit turns the new test green and keeps the rest green.

`tests/test_runtime.py` uses the Home Assistant pytest fixture. No test reads or writes `/home/steve/Documents/docker/hosted-external/hass-config`. Lovelace `.storage`, tokens, and secrets never enter this repo.

The reviewer reads those results and the tests in the diff. The coordinator includes this section in the global constraints handed to every reviewer.

## Working rules

- Snooze, blink, themes, double-tap, a dashboard card editor, per-card overrides, and importing AlertTicker or button-card config are review failures. If it is not in the task brief, it does not get built.
- `manifest.json`, the card URL `?v=`, and any version named in the README are the same value. A later edit changes them together.
- C2 is not ready for review until the report records the local harness: three alerts fade, the badge shows the count, hide removes the card, all-clear has no tap, unavailable shows `Banner unavailable`, a click logs more-info, and a drag past 10 pixels does not.
- README examples use the sensor contract from the spec.
- No amend, no force-push, no `--no-verify`. Commit messages stay the ones in the plan.

## Per task

Skill scripts, from `subagent-driven-development`:

- `scripts/task-brief PLAN_FILE N` writes the brief and prints its path.
- `scripts/review-package BASE HEAD` writes the diff package and prints its path. `BASE` is the SHA recorded before that implementer started. Never `HEAD~1`.

Brief and report live beside each other: `task-N-brief.md` and `task-N-report.md`. For these plans, name them with the task id (`task-e2-brief.md`, `task-i2b-report.md`) so evaluator Task 2 and card Task 2 do not collide.

### Implementer dispatch

Model is the Implementer cell for that row. A fixer uses the same model as the task it is fixing. The prompt contains:

1. One line on where this task sits in Banner Channels.
2. The brief path, as the requirements, including exact values.
3. Interfaces from earlier tasks that the brief cannot know. For I1 onward, name the files E1–C2 already committed. Do not paste those tasks.
4. Any ambiguity you resolved. Exact values stay in the brief.
5. The report path and the status contract: `DONE`, `DONE_WITH_CONCERNS`, `NEEDS_CONTEXT`, or `BLOCKED`. The report holds tests, commands, output, commits, and the self-review. The message back to you is status, SHAs, a one-line test summary, and concerns.

The implementer commits each file-changing step before starting the next one. A step that only runs a command is not its own commit. A failing test and the code that makes it pass stay in separate commits when the plan lists them as separate steps. The coordinator does not commit product code.

After each of those commits, record it on the plan step:

1. `git rev-parse --short HEAD` for that commit.
2. In the plan file, change that step's `- [ ]` to `- [x]` and append the short hash in backticks on the same line: `- [x] **Step 3: Commit** `a1b2c3d``.
3. Check off any command-only step that this commit just satisfied, with the same hash.
4. Commit the plan edit by itself: `docs: check off <task id> step <n> <hash>`. The hash written on the step is the product commit, not this docs commit.
5. Append the same hash to the ledger line for that step.

A task is not complete while any of its steps are still `- [ ]`. Do not batch a task into one commit and check every step against that single hash.

### Review

On `DONE` or `DONE_WITH_CONCERNS`, read concerns first. Correctness concerns go back to a fixer before review. Observations go into the ledger and then to review.

Dispatch the reviewer on `grok-4.7-high` with three paths: brief, report, review package. Copy that plan's Global Constraints into the prompt verbatim. Do not tell the reviewer what to ignore or how to rate a finding. Do not ask it to re-run tests.

Both verdicts are required: spec compliance and task quality.

- Critical or Important: one fixer, on that task's implementer model, for the whole list. The fixer appends test command and output to the same report. Then re-review the new range.
- Minor: ledger only. Hand that list to the final review.
- A finding that conflicts with the plan text: stop and ask Steve which governs. Do not patch over the plan.
- "Cannot verify from diff": resolve it yourself from the plan before marking the task complete. A real gap is a failed spec review.

### When an implementer stops

- `NEEDS_CONTEXT`: add the missing fact and re-dispatch the same model.
- `BLOCKED` because the task is too big: split it and stay on that task's model.
- `BLOCKED` from `grok-4.7-low` because the task needs more reasoning: re-dispatch that task once on the non-fast Composer. Later tasks keep the assignments in the table.
- `BLOCKED` from Composer because the task needs more reasoning: re-dispatch that task once on `grok-4.7-high`. Later tasks keep the assignments in the table.

Do not retry the same prompt on the same model with no new information.

## Home Assistant install gate

Steve installs Banner Channels into Home Assistant. The coordinator, implementers, and fixers do not.

Reading production Home Assistant is allowed: config files, logs, entity state, and a `docker exec` whose command only prints information. Writing production is not. That covers the Home Assistant config volume, Lovelace storage, entity registry, service calls, and any other production service on this machine. No container restart, no image update, no file copy into a hosted config, and no `docker exec` that changes state. Plan text that says to copy the component in and restart is overridden by this section.

After I2's code is committed, stop. Tell Steve to copy `custom_components/banner_channels` into the Home Assistant `custom_components` directory and restart Home Assistant. Wait for Steve to say that is done before treating I2's install step as checked.

I3's sidebar check is the same gate. The panel code can be written and committed. The dashboard check waits until Steve says the integration is installed, and Steve performs that check. After Steve reports a second restart, confirm with Steve that there is one sidebar panel and one card resource.

The between-step suites in the Tests section are the gates for code. A green run at the end of a task does not replace the runs between its steps.

## After I4

I4 is the README and `hacs.json` task. It is complete only when both of these are true:

- `hacs.json` `name` is `Banner Channels`, `homeassistant` is `2026.10.0` (replacing `2023.6.0`), `render_readme` is true, and `filename` is gone.
- `README.md` has an Install section and a Use section, as Task 4 specifies. `info.md` matches them.

1. Final whole-branch review on `grok-4.7-high`, using `scripts/review-package MERGE_BASE HEAD` and the minor-findings list from the ledger. Template: superpowers:requesting-code-review.
2. If that review has findings, one fixer on the non-fast Composer gets the whole list, then one re-review on `grok-4.7-high`.
3. Use superpowers:finishing-a-development-branch. Present merge, pull request, or cleanup. Do not merge or push unless Steve chooses that option.

## Stop without guessing

Stop and ask Steve when:

- A test count in a plan does not match the tests that plan lists, and the mismatch changes what "done" means.
- Home Assistant 2026.10.1 disagrees with a plan API, and more than one fix is plausible.
- A step would write to Home Assistant or any other production service. Stop and hand that step to Steve. Reading production state is allowed.
- Two plan sentences require different behavior.
