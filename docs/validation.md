# Validation

Current commit gate: **55 backend tests and 36 browser checks pass in the source installation**, with the latest UI production build/types/lint passing and a refreshed production dependency audit reporting zero vulnerabilities. See [the commit-gate receipt](commit-final-checks-2026-10-11.json). The earlier **fresh pinned installation passed 55 backend tests and 33 browser checks**; the later UI revisions were not reinstalled from scratch. See [the fresh-setup receipt](email-final-checks-2026-10-11.json). Production dependency audit reports zero vulnerabilities; 23 development/build-tool advisories remain. The sections below retain historical checkpoints; the latest result appears at the end.


## Isolated backend

`scripts/test_backend.py` compiles a copied server and runs **50 tests, all passing**. Source runtime records and `.env` are excluded. Tests use fake model responses/workers and temporary stores. The earlier fresh dependency environment passed the then-current 37-test suite. The expanded 46-test suite passed in the source environment after streaming changes; dependencies did not change.

Coverage: directory limits and Unicode/long names; older-worker lookup and complete pagination; retained full histories; explicit exact-worker reuse; stale/colliding target rejection; independent overlapping requests; same-task chat/schedule serialization; timeout after queue; extra phase cap; failed tool/worker/finalizer and missing final reply; transport dedup/conflicts; cancellation; restart interruption; schedule occurrence dedup/held interruption; active clear rejection and idle sidecar/legacy clear with content-free retry tombstones; legacy log compatibility and correlated draft records; fragmented SSE text and tool-call aggregation; isolated bounded worker partials; terminal clearing; provider error diagnostics; missing DONE/unsupported finish reasons; malformed tool argument rejection.

A separate reviewer inspected the final fixes for schedule replay, active history clearing, gate cleanup and final-response semantics and found no remaining blocker in that narrow review. The reviewer did not run tests.

## Fresh setup

A disposable source copy without data, secrets, installed dependencies or build output was created. Python 3.12.13 was installed into a new uv environment from `server/requirements.lock`; 47 packages installed from the local cache. Its backend compile/tests passed.

`npm ci --offline` initially failed because the cached YAML package was missing. Normal `npm ci` then succeeded from `web/package-lock.json`; clean lint and production build passed. No dependency versions were changed. The source frontend's final lint/build also passed. Browser database freshness advisories remain.

The clean backend started on loopback port 8002 with scripted providers and empty temporary data; `/api/v1/health` returned HTTP 200 and the task directory was empty. It was stopped afterward. This validates the dependency/startup path, not a real provider/Gmail setup.

That earlier dependency snapshot reported **27 vulnerabilities: 4 moderate, 22 high, 1 critical**. The final dependency update and current audit are recorded below. `git diff --check` passed.

## Browser integration

The production frontend on port 3000 was checked against `scripts/preview.py --demo` on port 8001. The backend copies source and records into disposable storage, blanks integration credentials, replaces model responses with deterministic fixtures and blocks external HTTP.

Observed:

- A fictional Nora email request produced a correlated draft card with recipient, subject and body.
- Continue selected that exact task and focused the composer; the Friday follow-up retained the same task ID and both drafts remained in history.
- Removing the target and requesting a subscription review produced a different task ID.
- A deliberately slow book request survived page reload through its acknowledged request ID and subsequently completed; pending ID storage emptied.
- A simulated worker failure remained visibly Failed.
- A simulated HTTP 409 removed the optimistic rejected bubble and restored input.
- A simulated HTTP 503 labeled the local message Delivery unconfirmed; only one POST occurred, with no automatic resend during observation.
- Two identical intentional submissions produced two distinct request IDs and two user records.
- Task inspection left the composer target unchanged. History pagination grew from 20 to 40 displayed entries.
- Task and Settings dialogs closed with Escape and restored trigger focus; mobile Continue closed the dialog and focused the composer.
- Desktop and a 390×844 rendered mobile window had no horizontal overflow and kept the composer in view. The host browser used 80% zoom (mobile CSS viewport approximately 487×1055); these are not device tests.
- The final clean navigation produced no browser console errors. Intentional rejected/unavailable HTTP simulations produced expected earlier network errors.

Screenshots are retained in the companion project study folder as `openpoke-build-desktop-final.png` and `openpoke-build-mobile-final.png`.

## Interaction refinement and repeatable browser checks

Public Kobra history, task-list and streaming examples informed interaction behavior. The refined UI uses a Your messages navigator, request-owned task rows, escaped Markdown with supplied links, Copy feedback and labeled provisional worker output. It does not fabricate a typing sequence or a reasoning transcript.

`scripts/browser_regression.js` is an async Playwright page function intended for a harness that supplies `page`; it is not a standalone Node command or CI runner. Its intercepted chat/history/status fixtures exercise safe links/code/HTML handling, message navigation and focus, provisional-to-terminal transition, no automatic retry, mobile dialog/composer behavior and exact duplicate draft display. No model calls or real data writes occur. The pre-deduplication scenario passed twice, and the final expanded scenario also passed. The final frontend lint and production build passed after the UI edit. A clean browser navigation showed zero console errors; the live Nora result displayed one draft card and no duplicate assistant body.

Screenshots in the companion project study folder: `openpoke-refinement-desktop-final.png` and `openpoke-refinement-mobile-final.png`. These are desktop-browser captures; the earlier zoom/device limitation still applies.

## Approved isolated live model evaluation

The user approved at most US$2 and no Gmail. `scripts/live_preview.py` copied server code to temporary storage and seeded 122 fictional workers. Worker tools, Gmail credentials and background jobs were disabled. Only capped OpenRouter completion calls were permitted, using Gemini 2.5 Flash Lite. Stored real app records and secrets were not copied. The budget receipt persists across restarts and is atomically replaced under a stable file lock.

The receipt records **17 of 20 reserved calls (US$1.70 reserved; maximum US$2)** at the end of the live evaluation. This is conservative accounting, not actual expenditure. One minimal probe returned usage cost US$0.0000019; total provider billing was not independently reconciled. Input size, output tokens and provider prices were also limited. No automatic budget refill is configured.

Observed failures were retained as findings: an initial provider finish error; a router-produced draft with no child worker and reversed sender roles; an explicit worker attempt ending at its output limit; and a failed finalizer. These were not counted as successful worker reuse. Failure states remained failures. Prompt changes clarified task continuity, draft roles, disabled tools and future-tense acknowledgments. A duplicate draft reply persisted despite the prompt instruction, so exact same-request body duplication is now folded deterministically in the frontend.

Successful samples:

- Explicit Nora continuation: request `7228397f-0083-40f8-bb07-bada743e9ce0` reused the exact saved task, produced a candidate-to-recruiter draft and succeeded. Live provisional output was observed.
- Model-selected Lisbon reuse: request `e663cca3-b543-4603-b626-9bae117afb07` reused the saved Lisbon task among the 122-worker roster and succeeded, with provisional output. The model used the existing worker directly; this did **not** exercise the fallback search tool.
- The repeatable CLI evaluation, `--case continuation`, passed for request `d740d28d-2ac7-4200-ad69-3523ddac9b70`, with the expected task ID, succeeded status and observed partial length 167 characters. Its draft roles were correct; its duplicate final body motivated the UI folding fix.

The browser uses polling to display genuine provider output; this is not browser SSE transport. Router/finalizer output and tool argument fragments are not published. Requests/runs expose bounded provisional worker text and observable tool activity only.

These few cases establish that the saved key works and demonstrate task reuse under this test harness. They do not establish reliable semantic retrieval, broad routing accuracy, production-model parity or integration correctness. The evaluation CLI asserts task IDs and status, not semantic response quality.

## Not verified

Broad live routing accuracy, fallback search with a live model, real Gmail/calendar effects, live scheduled integrations, multi-process safety, durable workflow resume, screen-reader use, mobile virtual keyboard/device behavior or hosted deployment have not been tested. Clipboard interaction was not verified. Restart/schedule behavior was tested with isolated stores and fake workers, not external effects.

The offline demo validates UI and harness plumbing; scripted worker selection is not evidence of model intelligence. Live samples are described separately above. GitHub PR status was unavailable because the read failed to connect. No push, deployment or submission occurred.

## Take-home checkpoint and default-model HTTP evaluation

A subsequent read of the first receipt showed 20/20 reservations used, and the temporary roster had been cleared. Earlier request IDs were then unavailable; historical results above were not silently presented as a fresh rerun. The user approved a separate additional US$2 no-Gmail budget.

The isolated server was restarted with fresh fictional records and Claude Sonnet 4, the default configured app model. The test profile reserves US$0.20 per call, permits 10 calls, limits input to 24,000 UTF-8 bytes/output to 1,536 tokens, and constrains provider prices. Reasoning is disabled for this capped test. No actual total billing reconciliation was performed.

The three-case HTTP evaluation returned two passes and one budget-blocked case, so its CLI exited 1. Evidence is retained in `api-evaluation-2026-10-10.json`.

| Case | First observed worker output | Terminal latency | Provider calls | Result |
| --- | --- | --- | --- | --- |
| Explicit Nora continuation | 2.063 s | 7.246 s | 4 | Expected worker ID, correct draft roles, succeeded |
| Natural-language Lisbon reuse | 7.079 s | 13.651 s | 6 | Expected worker ID, previous suggestions retained, succeeded |
| Separate reading-list task | None | 0.023 s | 0 | Reservation cap rejected call before model execution |

Acknowledgments took 2–5 ms on the local API; these are individual samples, not typical latency or a before/after speed improvement. Provider-call counts came from the reservation trace. Fallback search was not invoked. The Nora final reply still asks whether the draft is ready to send even though this test mode disables Gmail; this is a remaining capability-awareness finding, not evidence that anything was sent.

The second receipt reached 10/10 reservations (US$2 reserved), and the first reached 20/20 (US$2 reserved). Both caps remain enforced; the combined US$4 reservations are not actual spend. Additional paid testing requires a new approved budget. The UI continues to expose completed test results and the budget-limited failure; no additional frontend feature was implemented during this scope review.


## Final completion pass

The backend suite now has 50 passing tests. Four added tests exercise the real ASGI routes and router/worker/coordinator loops with scripted provider responses: older-worker lookup and explicit continuation, independent overlapping ownership/failure, intentional repeated messages versus retry deduplication, and rejection before dispatch. External transports are blocked. These prove harness mechanics, not live model judgment.

The portable Playwright suite (`npm run test:browser --prefix web`) passed all four checks against an independently started disposable backend/frontend. It covers history/focus and safe Markdown, concurrent request navigation and stale status, two independent workers over loopback HTTP, and rejection of delayed status that would regress terminal work. Fixture concurrency removes the first task target before submitting the second request and asserts the outbound IDs. HTTP concurrency observes two distinct request IDs and worker IDs before completion. No paid calls occurred.

The refined UI adds an Active work overview, compact supplied-source links, Unicode bullet lists, clearer response/action sizing and mobile spacing. Unavailable polling is explicitly labeled as last-known status; retained output is labeled last received. Terminal state cannot regress because an older poll arrives late. Normal-scale desktop and 390×844 headless browser captures replace the earlier zoom-limited screenshots for this pass. They do not establish physical-device or screen-reader behavior.

Next.js 14 had no compatible fix for a current critical advisory. The localized update pins Next.js/eslint-config-next 15.5.27, React/React DOM 19.2.8, PostCSS 8.5.23 and its Next override, and refreshes source-map-js. Two dynamic API route handlers now await route params. Production audit reports zero vulnerabilities; the full dependency audit retains 23 development/build-tool advisories (19 high, four moderate). Tailwind 4/build-tool migration is deferred rather than forced into this product slice. References: [Next.js release](https://github.com/vercel/next.js/releases/tag/v15.5.27), [upgrade guide](https://nextjs.org/docs/app/guides/upgrading/version-15), [support policy](https://nextjs.org/support-policy).

The isolated live-test prompt was tightened to offer editing/manual copying when integrations are disabled. That prompt adjustment has not been rerun with a paid model; the earlier capability-awareness finding remains a validation gap. Both approved paid reservation caps remain exhausted.


## Final fresh-install verification

A new disposable source snapshot included every tracked and intentional untracked source file, excluding ignored `.env`, runtime records, virtual environments, node_modules, build output and browser artifacts. It installed 47 Python packages with uv into a new Python 3.12.13 environment and 392 npm packages with `npm ci`. In that clean installation, all 50 backend tests, frontend lint, production build, all four portable browser checks and the production-only audit passed. The browser runner started and stopped its own servers on 8003/3013. Build warnings concern aging browser compatibility data and the future removal of `next lint`; lint produced no rule warnings/errors.

The final source preview was restored on 3000 with the disposable offline backend on 8001. Both health and frontend returned HTTP 200. This session made no additional paid model calls or Gmail actions. The source remains local until separately approved publication.

## Approved task-workspace refinement — 11 October 2026

The current gate is **53 backend tests and 11 portable browser checks**, frontend lint and production build, and git diff checks. The browser suite completed in 17.6s against the source production build, using disposable servers on 8003/3013. Its added cases prove read-only selected-task history, 40-row pagination retained across background completion, exact task name/ID continuation, pinned long results, preserved deliberate scroll position, composer focus without stealing focus, mobile unique IDs/Escape/New task focus, rejected keyboard-send recovery, failed-mode dispatch blocking, pending-lookup cancellation without dispatch, and zero Demo Gmail requests. Existing cases still cover concurrent independent workers, failure ownership, safe Markdown and terminal-state guards.

A separate clean intentional-source snapshot installed 47 Python packages and 401 npm packages with the pinned lockfiles; ignored credentials, runtime records and build artifacts were excluded. Clean-copy lint, final production build and all 53 backend checks passed. The eleven browser checks ran in the source checkout, not this clean copy. Production-only npm audit returned zero vulnerabilities; the existing 23 development/build advisories remain. Build warnings concern aging browser compatibility data and next lint deprecation.

A direct in-app-browser continuation and real local HTTP/proxy inspection reached succeeded with Nora's exact task name and ID, a 0px bottom gap and textarea focus. This was a deterministic offline response, not a paid model accuracy evaluation. Reviewed screenshots and the machine-readable receipt are in [UI review](ui-review.md) and [workspace checks](workspace-checks-2026-10-11.json). No paid calls, Gmail actions, real-history clearing, push, deployment or submission occurred. The isolated preview was restarted with current code and fresh fictional samples; actual server/data records were preserved. Signing remains unresolved, so changes are local and uncommitted.


## Beautiful UI component integration — 11 October 2026

Adapted free MIT SidebarNav rail/recent rows and TaskRows presentation with attribution. Final source lint, production build (139kB first-load JS), diff whitespace check and all 12 browser checks passed (22.1s). The new test covers stable manual disclosure, reduced motion and persistent failure without demo recovery. One initial browser attempt had an ambiguous selector between saved-task navigation and the new task-status button; the selector was scoped to navigation and the full suite rerun. The first screenshot also exposed duplicated status/empty details, corrected before the final build. Backend code and dependencies were unchanged; no backend or clean-install result is newly claimed by this pass. No paid model calls or Gmail actions occurred.


## Approved composed-interface and newest-history pass — 11 October 2026

**55 backend tests passed** in a clean Python dependency environment; **all 18 browser checks passed in 26.7s** on the final production source build. Final lint has no rule warnings/errors; production build reports 156kB first-load JavaScript. A live production-only npm audit reports zero vulnerabilities. Diff whitespace checks passed. The earlier 23 development/build-tool advisories were not remediated in this pass.

The new UI coverage proves editable recommendation prompts, slash shortcuts, exact-ID @ targeting without dispatch, Enter staying local for empty suggestions, quoted reply review, rejected-send draft/target preservation, actual clipboard feedback, newest bounded history and earlier paging with a stable visible anchor, refresh while reading, activity filters/search, mobile review action visibility/no horizontal overflow, Escape focus and reduced-motion behavior. Existing checks still cover independent concurrent workers, stale status, safe Markdown and pending/error handling. Test fixtures remain separate from local HTTP with scripted workers.

A new disposable snapshot installed 47 Python packages and 403 npm packages from the pinned locks, excluding credentials, runtime data and build artifacts. Clean lint/build and all 55 backend tests passed there. Final mobile CSS/label and dialog-stacking fixes were then verified by the final source build and complete browser suite. The temporary copy was removed after the disk filled during an earlier failed trace write; no user data or budget receipts were removed. Historical failure artifacts and outputs were retained.

Browser tests caught a real activity backdrop stacking defect, now fixed and verified. Earlier attempts also caught stale test selectors after text glyphs became accessible icons; assertions were updated to actual names and the full suite repeated. A local browser/HTTP follow-up reached succeeded on Sample · Reply to Nora with exact task ID. It used deterministic demo responses, not live semantic generation. Current preview remains explicitly Offline demo on 3000/8001; both approved paid reservation budgets remain exhausted.

See [component/code guide](composed-ui.md), [machine-readable receipt](composed-ui-checks-2026-10-11.json) and screenshots in the updated UI review. No paid-model call, Gmail action, real-history clearing, push, deployment or submission occurred. Physical-device, screen-reader, broad live routing and integration gaps remain.


## Navigation refinement — 11 October 2026

Direct navigation reproduced two defects: opening/canceling Your messages discarded the selected saved-task reader, and New task retained a quote review capable of restoring the old target. Both now have tests that failed on the previous production build and passed on the final build. Initial New task test setup was corrected to select a metadata-bearing task through @ search before establishing those failures.

MessageNavigator is mounted outside the conditional reading panes, so opening/canceling preserves the saved reader and scroll. Choosing a search result deliberately navigates to its original message index and focuses it. Search is local to loaded requests. New task clears pending excerpt ownership and target, preserves unsent text, and restores composer focus. Switching the selected saved task clears pending quoted review.

All **21 browser checks passed in 27.2s**, using isolated servers on 8003/3013, with final lint/build and diff checks passing. Build remains 156kB first-load JavaScript. No backend, fresh install or audit rerun is claimed; no dependencies changed. Existing checks retain concurrent scripted-worker HTTP, failures, repeated interactions, scrolling and accessibility assertions.

Manual desktop and mobile navigation verified search/cancel, task switching, quote removal and draft preservation. At an actual 390×844 CSS viewport, document width was 390px, search input was 16px, and the dialog occupied 352px with 19px side margins. Temporary viewport override was reset and the test tab closed; the user's existing Settings tab was not reloaded. No request was submitted during the manual pass, no paid model call or Gmail action occurred, and real history was preserved. Physical-device, screen-reader and live semantic accuracy remain unverified. See [receipt](navigation-checks-2026-10-11.json) and [captures](ui-review.md).


## Activity inspection and recovery — 11 October 2026

Manual navigation found that View request carried an unrelated saved-task quote into All messages. The fix clears pending quoted review on deliberate navigation, while leaving unsent typing and the existing explicit composer target unchanged. Canceling Activity preserves the saved reader and pending review. New desktop/mobile regressions fail on the previous production build with one unexpected quote card, then pass on the fix. An initial exact row selector omitted date metadata; its interrupted setup attempt is not product evidence.

Activity now has Clear search (retains status filter) and Show all activity (resets query and filter); both return focus to search and remain local. Saved-task counts use singular/plural copy, and filtered rows say Search results. The mobile search uses 16px text.

An initial 24-test pass completed in 25.6s, but its screenshot revealed that the mobile table clipped the View request action. The final mobile layout keeps Task, Status and Actions visible, placing origin/time under the task. The regression now asserts action bounds inside the visible table, zero table/document horizontal overflow and visible metadata. **All 24 final browser checks passed in 26.7s**, with production build/lint/type validation and diff checks passing. First-load JavaScript remains 156kB. No backend, audit or fresh-install rerun is claimed; no dependency changed.

The final in-app-browser desktop walkthrough verified quote removal, exact-message focus, draft preservation, search clearing, reset and Escape focus. This turn's viewport override did not apply to the background test tab, so the 390×844 mobile evidence is explicitly from Playwright and its saved capture. No manual request was submitted, paid call or Gmail action occurred, and existing history was not cleared. See [receipt](activity-refinement-2026-10-11.json) and [captures](ui-review.md).


## Composer targeting and quote state — 11 October 2026

Direct testing reproduced a reminder quote remaining after selecting Nora through @ search, and the shortcut button inheriting @Nora as its filter and showing no commands. Four regressions failed against the previous build: different-worker quote ownership on desktop/mobile, missing shortcut choices, and stale custom instruction after selecting another reply.

Explicit task changes now discard pending quotes owned by a different worker, but continuing the matching worker retains its quote. Removing a task clears its pending task-owned quote and restores composer focus without losing typing. All messages navigation also clears pending review. Quote content/task keys reset review-local choices for a changed selection without a prop-reset effect.

Shortcut-button commands ignore pending task-query text and append a separate paragraph while preserving input. Task-search loading/errors apply only to the task menu; keyboard shortcuts remain usable after switching menus. Send and form submit are guarded while suggestions are open, matching Enter behavior. Escape deliberately dismisses suggestions without altering text.

**All 29 browser checks passed in 28.7s**, with final production build/lint/type validation and diff checks passing. Desktop and 390×844 mobile checks preserve worker IDs, matching quote state, independent drafts and zero dispatch for preparatory interactions. The unresolved-menu test holds the task lookup open, then returns no matches, and verifies Send stays disabled until dismissal. First-load JavaScript remains 156kB. No backend, audit or fresh-install rerun is claimed; no dependency changed.

Final manual desktop actions verified three available shortcuts, keyboard selection, separated insertion, Send disabled during task picking, and reminder quote removal after choosing Nora with draft/focus preserved. The test tab was closed and the existing user tab was not reloaded. No paid calls, Gmail actions, real-history clearing or publication occurred. See [receipt](composer-refinement-2026-10-11.json) and [captures](ui-review.md).


## Email presentation and final gate — 11 October 2026

A new disposable intentional-source snapshot excluded credentials, runtime data, installed dependencies and build output. It installed 47 Python packages with Python 3.12.13/uv and 403 npm packages from the pinned locks. Fresh backend compilation and all 55 tests passed (0.764s), lint had no rule warnings/errors, and types/production build passed (156kB first-load JavaScript). All 33 browser checks passed in 29.9s in this fresh installation. Source backend also passed all 55 tests and the source production build passed. A production-only npm audit returned zero vulnerabilities; npm ci reported the existing 23 development/build-tool advisories. Whitespace diff checks passed.

The first browser attempt passed 31/33: the new desktop test attempted a task outside the first page without search, and the mobile test used an incorrect accessible button name. Correcting those test selectors and rerunning all checks passed. No product change was made to disguise those failures.

Email cards now persist across conversation, saved history and partial output. New checks establish copy fidelity, exact-worker continuation, previous/revised draft retention, no horizontal overflow on the mobile fixture, ordinary/quoted prose fallback, supplied header preservation and escaped HTML. Manual in-app-browser inspection confirmed the existing Nora history renders as email cards without rewriting records. This is output presentation, not real mailbox threading or integration proof. Physical-device and screen-reader behavior remains unverified.

The isolated paid-test harness now seeds eight recent unrelated workers and exposes test-only directory/tool observations. An offline preflight verified the Lisbon fixture was absent from the eight-entry shortlist, full search found it, and instrumentation preserved the tool result without creating a provider reservation. `evaluate_routing.py --case fallback` also requires a successful observed model search and exact task ID before passing. Its paid execution is pending an additional approved budget; this preparation is not live fallback proof. Gmail, external tools and background jobs remain disabled in that harness.

The production frontend is restored at 3000 against the existing disposable offline backend at 8001. Existing local history was preserved. This pass made no paid calls, Gmail actions, history clearing, push, deployment or submission.


## Additional US$5 live approval and user handoff — 11 October 2026

A new explicit US$5 approval uses one persistent receipt shared by agent and user tests, Claude Sonnet 4, and at most 25 reservations at US$0.20 each. Worker external tools/Gmail and background jobs are disabled; application records are fictional and temporary. Earlier approved receipts remain exhausted and unchanged.

The absent-shortlist Portugal/Lisbon test made six real provider calls. The model invoked search five times but did not select the saved worker. The next attempted input exceeded the harness's unchanged 24,000-byte cap and was refused without a further reservation. This is a failed fallback case, not proof of general older-worker recall. Separate-task creation then made eight calls and succeeded with the exact new Reading list fixture ID. First received worker text appeared at 3.431s; terminal status arrived at 16.993s. Its final message also brought up the earlier failed Portugal request, showing a context-quality issue despite distinct execution ownership. Public-domain/content accuracy was not verified. No before/after speed improvement or broad accuracy rate is claimed.

At handoff the receipt records 14/25 reservations, US$2.80 reserved and US$2.20/11 calls remaining. This is not a billing measurement; user interactions consume the same remaining cap. No more agent-paid cases were run, preserving remaining reservations for user testing. A fake exhausted 25-call receipt and invalid 26-call CLI check confirmed refusal without provider access or resetting the real receipt.

The preview API now exposes its configured public test budget; the frontend displays US$5 rather than a hard-coded US$2. The source build/types/lint and all 34 offline browser regressions passed (31.9s), including correct live-mode label and zero Gmail requests. Backend application code was unchanged; the prior fresh 55-test result remains the backend evidence. Live frontend 3002 and backend 8015 returned HTTP 200/healthy. In-app navigation to the rebuilt page was blocked by the browser client, so no refreshed live screenshot is claimed. The accessible URL is supplied for manual opening. See [live receipt](live-evaluation-2026-10-11.json).


## Local commit gate — 11 October 2026

The finalized source passed all 55 isolated backend tests (0.746s) and 36 browser checks (35.9s), including desktop/mobile composition and preservation of separate workers' controls within one request. The latest compact-sidebar production build includes type and lint validation; only documentation changed afterward. The refreshed production-only npm audit returned zero vulnerabilities. The previous 23 development/build-tool advisories remain the recorded development audit; no new full development audit is claimed.

A competing unrelated service also listened on port 3002 and served the in-app 404. OpenPoke now uses loopback port 3016 against the same isolated backend on 8015. Rendered inspection verified the compact, vertically centered sidebar rows, combined email header, contained test-mode badge and saved-draft/incomplete-response distinction. Sidebar desktop row height measured 36px; coarse-pointer CSS retains a 44px minimum. Backend records were preserved.

The README now describes current behavior, secure local environment setup, cap-label configuration, separate offline/live evidence and unresolved discovery/context failures. The commit file scan found no credential/runtime-data candidates. This gate uses no new paid calls, Gmail actions, history clearing, deployment or submission. The source remains a take-home slice rather than a claim of reliable open-ended agent operation.
