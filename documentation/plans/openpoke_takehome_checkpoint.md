# Take-home checkpoint — 11 October 2026

The core selected slice is built locally: bounded worker discovery, a composed chat/task interface and exact Continue this task. It follows the supplied brief; the original assignment text has not been supplied. Exploration mapped possible work rather than committing to a full agent platform.

| Brief requirement | Current evidence | Remaining gap |
| --- | --- | --- |
| Execution Agent Overload | Initial directory: eight entries/4096 bytes; full-roster lookup and preserved histories; offline absent-shortlist retrieval verified | Paid fallback/ambiguous-routing evidence; whole worker prompt history still grows |
| Thoughtful frontend | Actual request-owned status, partial output, task inspection, email cards, search, pinned composer, failure recovery; 34 browser checks | Physical-device and screen-reader proof |
| Useful feature | Exact Continue this task preserves worker/history and bypasses model routing | Wider user study |
| Reproducible setup | Fresh pinned installation: 47 Python/403 npm packages; 55 backend tests, 34 browser checks, lint/types/build pass | Real integrations remain untested |
| Repository and tradeoffs | README, engineering decisions, component map, five-minute walkthrough and separate receipts | Reviewed commit/signing, authorized publication; branch remains local |

The four architecture changes are bounded routing context, request-owned worker phases, a SQLite request/run sidecar and bounded provisional provider output. Existing Interaction/Execution roles and legacy histories remain. Same-task chat/schedule execution is serialized; independent tasks can overlap. Restart records interruption without replay. Email presentation does not change these contracts or add mailbox threading/send authorization.

Historical default-model tests continued Nora and reused Lisbon in four/six provider calls (7.246/13.651 seconds). Separate-task coverage stopped at the prior cap. No comparative latency baseline or general accuracy rate exists. The latest UI/check pass makes no paid calls. Both earlier US$2 reservation budgets are exhausted; a subsequent explicit US$5 approval is now active and shared with user testing. The newly prepared fallback case rejects a fixture already visible in the initial shortlist and requires an observed successful search before exact reuse.

Freeze new feature work. Next: Daniel’s capped live testing and walkthrough, a discussion of the observed recall/context-quality gaps, then review/commit/publication. Webhooks, compaction, semantic indexing, new providers, runtime skills and durable automatic recovery remain study-roadmap items. No model was trained. Time across multi-day research, user work and agent turns was not tracked reliably; compliance with a 6–8 focused-hour allowance cannot be claimed.

Latest evidence: `../../docs/email-final-checks-2026-10-11.json`, `../../docs/validation.md`, `../../docs/walkthrough.md`. Production audit is clear; 23 development/build-tool advisories remain. Earlier signed commit attempt failed due to the configured 1Password key; signing configuration is preserved and no unsigned override is assumed approved. No commit/push/deploy/submission occurred.


Additional live result: separate-task routing succeeded, while the absent-shortlist Portugal/Lisbon test failed after search attempts and the input guard. Final new-task prose also referenced the older failed request. At handoff 14/25 reservations were used (US$2.80 upper-bound reservation), leaving 11/US$2.20 for user testing. Live URL: http://127.0.0.1:3002/. These findings qualify earlier completion claims; exact routing ownership alone does not prove response relevance or factual accuracy. See `../../docs/live-evaluation-2026-10-11.json`.
