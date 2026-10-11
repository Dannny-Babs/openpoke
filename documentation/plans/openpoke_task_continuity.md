# OpenPoke: bounded discovery and task continuity

2026-10-10. Implementation authorized by the user's “okay build now”, following review of the storyboard. Scope is local build and verification; delivery/push/deployment remain separate.

## Combined draft

### Useful work with reliable continuation

The full persisted roster bloats routing context. The original UI also infers completion from matching message text and the latest assistant response, while globally overlapping workers can share a completion batch. A continuation control needs a real target and an outcome associated with its originating request.

**Goal:** retain old work, bound routing-directory context, let users deliberately continue a saved task, and show actual request/run outcomes in the reviewed responsive interface.

**Preferred approach:** retain the legacy roster and worker histories; use the existing bounded lexical shortlist with paginated fallback lookup. Add a SQLite sidecar for requests and worker attempts, a request-owned coordinator and shared same-task execution gates. Implement the storyboard's composition with the current React/Next dependencies and browser primitives.

**Alternatives:** read-only task browsing alone is smaller but does not deliver reviewed continuation; a full identity migration/vector index/durable workflow system adds unneeded scope and new guarantees to validate.

### Current implementation direction

- HEAD is `5b5f635935a64ab37884c025d70abb0ed731c094`; existing local discovery/history/UI edits were preserved and inspected before reuse.
- Directory payloads are capped at 8 entries/4096 serialized UTF-8 bytes; fallback pages at 20 entries/8192 bytes. Full histories remain persisted.
- Exact-name hash lookup keys preserve legacy ownership; they do not survive renaming. Legacy slug collisions need rejection at every execution entry.
- Original detached chat handling, global completion batch and text-based polling do not establish request completion.
- Targeted read-only directory and lifecycle reviews completed before implementation assignments.

### Required behavior

- An old worker remains discoverable beyond the shortlist; no history or trigger ownership is renamed/deleted.
- Continue selects a task and focuses the composer; submission dispatches directly to that exact worker.
- Missing or ambiguous legacy task references fail before acceptance; they cannot silently create replacements.
- Identical intentional inputs remain different requests; delivery retry with the same submission identity cannot launch another request.
- All worker attempts belong to one input request. Unrelated concurrent inputs cannot join its result batch.
- Same-task worker execution is ordered across chat and schedules. Acquire its gate before request logging/history loading; queue wait does not consume execution timeout.
- Inspect unsuccessful model/tool outcomes and final reply generation. Progress is not completion.
- Persist request/run statuses; mark unfinished records interrupted after restart, without replaying external operations.
- Preserve legacy conversation records and attach correlation metadata only to new records.

### Risks / follow-ups

- SQLite status persistence is not a durable queue, multi-process execution gate or exactly-once external-effect guarantee. This remains a single-process local app.
- Explicit targeting removes selection ambiguity for that path; live natural-language routing quality remains unmeasured.
- A failed write/timeout may have had an effect. Expose uncertainty and avoid automatic execution retry.
- Worker history remains large; source-preserving compaction and runtime skill discovery are later harness work.
- Remaining interview-wide time is unknown. The prior continuity estimate was 8–12 future hours; it is not a claim that total effort fits the original 6–8-hour summary. Keep scope focused and record actual checks.

## Specs

### Functional spec

1. Search saved tasks, inspect history, and select an unambiguous task for continuation.
2. Submit text with optional task target; show an accepted request identity and actual statuses.
3. Allow independent inputs while older work is pending. Preserve the association for every result/failure.
4. Show useful recorded replies/drafts without fabricated version, context-source or progress claims.
5. Handle missing configuration, rejected input, lost status connectivity and interrupted work distinctly.
6. Keep keyboard focus, small-screen navigation and a reachable composer consistent with the reviewed direction.

### Technical requirements

- `POST /api/v1/chat/send`: existing messages plus optional `task_id` and UUID `submission_id`; JSON 202 `{request_id,status,task_id}`.
- `GET /api/v1/chat/requests/{request_id}`: `{request_id,status,task_id,origin,error,created_at,updated_at,runs}`.
- Request states: queued, routing, running, responding, succeeded, failed, interrupted. Child run states: queued, running, succeeded, failed, interrupted.
- Each run exposes id, task_id, task_name, status, error, response and timestamps. One run means one worker attempt; request means the owning input.
- New chat records may expose stable id/request_id/task_id; legacy records remain readable.
- Coordinator retains background handles, seals routing phases, gathers owner-only workers, and awaits final Interaction Agent processing. Extra delegation phases are bounded.
- Same-task gate sits at the shared execution boundary, released before final IA processing. Scheduled work uses the same gate/coordinator.
- New sidecar storage requires no legacy migration. No secrets or real runtime data are used for verification.

### Non-goals / out of scope

Webhook registration, new providers/subscription logins, runtime skill platform, vector service, full worker compaction, automatic sends, restart replay, public authentication/hosting, image generation and purchased components.

## Requirements

### Must have

Bounded discovery with old-work access; reviewed frontend; explicit continuation; request/run correlation; failure visibility; same-task ordering; preserved legacy data; reproducible setup and tradeoffs; offline behavioral verification.

### Should have

Reload recovery for pending requests, request-status retry after transport failure, responsive history navigation and metadata-backed artifact continuation.

### Nice to have

Real streaming, optional sound and richer task metadata after their capabilities can be validated.

## Checklist

- [x] Original flow, preserved patch and targeted reviews inspected.
- [x] Scope, contract, alternative and ownership converged.
- [x] Coordinator/status persistence and API implemented.
- [x] Same-task gate covers chat and schedule paths before history writes.
- [x] Frontend uses request IDs and explicit target selection.
- [x] Backend regression checks pass using temporary stores/fake runtimes.
- [x] Frontend lint/build and rendered flow checks pass.
- [x] Fresh install/start verified; README/tradeoffs updated with actual results.

## Details to confirm your fix

- Can an older exact target be reused after reopening the stores?
- Can fast work finalize before the router finishes registering another worker? It must not.
- Can a later queued instruction appear in the earlier worker's initial history? It must not.
- Can an unrelated reply complete an active input? It must not.
- Does final reply failure retain the fact that worker work may already have occurred?
- Does restarting mark pending work interrupted rather than silently succeeding/replaying?
- Does inspecting a task leave the composer target unchanged until Continue is chosen?

## Implementation steps

1. Preserve the initial local source snapshot; retain all legacy runtime records.
2. Backend owner: model/status contracts, sidecar/context/coordinator, shared execution gate, chat/schedule paths and lifecycle regression checks.
3. Frontend owner: reviewed task/conversation layout, exact target composer, request status polling, responsive history and metadata-backed results.
4. Integrator: directory restart regression, setup/docs, API integration and targeted browser checks.
5. Independent reviewer: check implementation against these acceptance contracts and fix concrete findings.
6. Fresh setup and local handoff; report remaining live integration gaps.

## Testing strategy

Use `scripts/test_backend.py`, which copies only server source into temporary storage with credentials disabled. Tests cover directory sizes/pagination/history/trigger ownership and add lifecycle, owner-only concurrency, phase sealing, same-task queue history/order, chat-schedule parity, failures, idempotency and restart interruption. Use fake provider/tool outcomes and real temporary SQLite/log stores.

Run `npm run lint --prefix web`, `npm run build --prefix web`, and browser checks against the approved build with disposable data. Check desktop/mobile, task selection/removal, rejected submit, status errors, slow running/terminal states, intentional identical messages, Escape/focus and an older target. No existing Playwright page-object/test harness is present; use observed accessible locators and deterministic response/state waits for targeted checks instead of importing platform-specific RR commands.

## Rollout

Local only. Keep existing data untouched; sidecar creation is additive. Do not automatically retry interrupted runs. A source rollback cannot undo an external action. No push, deployment or submission in this authorization.

## Acceptance criteria

The must-have behaviors are implemented and exercised at their described seams, the UI is rendered on desktop/mobile, setup can be reproduced from declared locks, and documentation separates offline/model-mocked proof from untested live model/Gmail/schedule behavior.

## Open questions

The original interview brief/assistance rules and total remaining hours were not supplied. User explicitly authorized this build. The user subsequently approved two separate US$2 isolated-model budgets, with Gmail disabled. A disposable Gmail account and direct-provider versus subscription-token meaning remain unresolved and outside this implementation pass.

## Verification & definition of done

Record actual automated/browser/fresh-setup results and reviewer findings. Do not claim natural-language routing accuracy, durable replay or real integration outcomes from mocks. Return the local URL, changed behavior, test evidence and material limits. No implementation approval question is repeated.
