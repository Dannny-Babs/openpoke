# Engineering decisions

## Worker-directory growth

The Interaction Agent received the complete saved worker roster on every routing turn, including turns triggered by worker results. Each new worker increased that input even when it was idle. Limiting concurrent execution would leave this directory growth unchanged.

I kept the roster and worker histories, but changed the initial directory to a locally ranked shortlist of at most eight entries and 4,096 serialized UTF-8 bytes. Search over the full roster returns up to 20 entries and 8,192 bytes per page. [TaskDirectory](../server/services/execution/directory.py) owns these bounds and exact worker lookup.

| Approach | Benefit | Tradeoff |
| --- | --- | --- |
| Recent workers only | Small change | Older work disappears from discovery. |
| Bounded shortlist with full lookup | Preserves old workers without another service | Recall depends on task names and the model's search choices. |
| Semantic index | Could improve paraphrase recall | Requires indexing, maintenance and evaluation. |

I chose the shortlist and lookup to bound directory input while preserving existing storage. Eight is an initial engineering limit, not a measured optimum; the byte cap also bounds entries with long names. Tuning these limits needs evaluation of lookup success and model input cost. Search matches names, not transcript contents. A live "Portugal art outing" request failed to find the saved Lisbon task. The directory also still scans the saved roster; bounding its output does not make lookup constant-time.

## Added feature: Continue this task

A follow-up previously relied on the Interaction Agent inferring which worker to reuse. Continue selects a removable exact task ID, which the backend validates before dispatch. Opening history is read-only; it does not change the next request's target. [The page](../web/app/page.tsx) owns selection and submission.

This gives users a direct way to reuse existing work. It bypasses the routing decision, while worker execution and final response generation still use models. IDs hash exact legacy task names, so renaming is not supported as a stable identity operation. Histories whose legacy filenames collide are rejected for review.

## Execution and persistence

The original shared completion batch could combine unrelated workers' results. I added a [request coordinator](../server/services/execution/request_coordinator.py) so each input owns its worker attempts and final reply. Delegation is capped at three phases. A shared per-worker gate serializes history loading and execution across chat and schedules; different workers can run concurrently.

Request ownership and per-worker ordering support explicit continuation without mixing unrelated results or concurrently overwriting one worker's history. This extends beyond the directory fix; the interface changes make those behaviors visible to the user.

A [SQLite request store](../server/services/execution/request_store.py) records state and submission IDs without migrating the legacy logs. Reusing a submission ID retrieves the same request; a new ID represents an intentional new message. Schedule occurrences also have identities to prevent duplicate dispatch. Clearing history rejects active writers and retains content-free submission markers after removing records.

Restart marks unfinished work interrupted. It does not replay it automatically, because an external action may already have happened. This is single-process coordination, with no durable workflow resumption or guarantee of exactly-once external effects. Completion requires a final reply after worker results. A draft can therefore be saved while the overall request remains incomplete.

## Frontend and saved history

The chat needed to make ongoing work and follow-ups easier to inspect. I added a saved-task sidebar, a main-pane history reader, exact-target prompt controls and an activity view. The composer stays reachable, deliberate reading survives refresh, and rejected submissions preserve input. Worker status and received output are shown separately from the final reply.

I adapted free Beautiful UI components and used Base UI dialogs, Lucide icons and Sonner feedback. [Third-party notices](../THIRD_PARTY_NOTICES.md) retain attribution. Provider streams are assembled on the server; the browser polls pending output every 500 ms. Keyboard navigation, focus restoration and mobile layout have offline checks. Physical-device and screen-reader behavior still need testing.

[EmailReply](../web/components/ui/EmailReply.tsx) formats supplied email headers and body. Draft records say Not sent; generic saved replies say Delivery not tracked. Copy preserves the original text. The local prompt-review card prepares a follow-up and does not authorize external actions. Real mailbox threading, attachments and tool approval enforcement are outside this change.

History display starts with a bounded latest page of 20 records and 32,768 serialized UTF-8 bytes. Earlier pages preserve the reading position. This avoids rewriting legacy logs, but loading still scans the file and worker prompts can include full history. Next.js and React were updated to the pinned versions in the lockfile to address the production dependency advisory; development/build-tool advisories remain.

## Remaining limits and evidence

The change bounds the initial worker directory and each search page, not the whole model prompt. Repeated search results and other tool messages can still accumulate within a routing turn. OpenPoke already has conversation summarization, but this build adds no enforced whole-prompt budget or per-worker compaction. The isolated live harness disables summarization and exposed failures as its conversation grew. A separate-task response also referred back to an earlier unrelated request.

Recorded offline checks cover execution rules and UI behavior. They do not establish broad model routing accuracy or semantic correctness, and this documentation update did not rerun them. The small live sample shows useful continuation and separate-task behavior alongside the discovery and context failures. [README checks](../README.md#checks-and-limitations) contains the commands and recorded results.

The isolated demo disables Gmail and external worker actions. The persistent app has no account-level access control or enforced tool approvals, so a public live demo needs those boundaries and a spending limit. Restart interruption reporting also does not provide durable recovery of external actions.

## With another week

1. Expand live routing evaluation around older tasks, paraphrases and ambiguous follow-ups. Compare retrieval changes against those cases before adding a semantic index.
2. Budget the complete router and worker prompts. Add summaries that retain references to source records, then test repeated interactions and recovery of older context.
3. Define approvals and recovery for external tools, using disposable integration data. Test what happens when an action succeeds but response generation fails.
4. Finish physical-device and screen-reader checks and address remaining development dependency advisories. Webhook ingestion and additional providers would follow the reliability work.
