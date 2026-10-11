# Engineering decisions

## The problem

The complete persisted worker roster originally entered every Interaction Agent routing turn, including background results. Prompt growth depended on all workers ever created. A concurrency cap would not address that input growth.

The change keeps the roster and histories, but bounds the initial directory to eight locally ranked entries and 4,096 serialized UTF-8 bytes. Full-roster search returns at most 20 entries/8,192 bytes per page. Exact task lookup validates the authoritative roster before reuse. These are directory bounds, not whole-prompt or execution-history bounds.

| Option | Benefit | Cost |
| --- | --- | --- |
| Recent workers only | Small patch | Older work becomes undiscoverable |
| Bounded lexical shortlist plus full lookup | No added service, measurable bound, preserves old workers | Vocabulary and model fallback behavior limit recall |
| Semantic index and new task identities | Potentially stronger recall | Indexing, migration and evaluation exceed this slice |

We selected the shortlist and fallback. Search uses names, not transcript contents or paid embeddings. Empty search results do not prove no related work exists. Keys are SHA-256 hashes of exact legacy names, so renaming is not supported as a stable identity operation.

## Continuation requires ownership

The useful feature is “Continue this task.” Inspection leaves the composer alone; continuation sets a removable explicit target and bypasses model routing. Stale targets and mixed legacy history are rejected before acceptance. History display is paged and bounded; full stored records remain intact.

To make this credible, a request now owns its child worker attempts and final response. Workers register during a phase; that phase seals before results are collected. Additional delegation is capped at three worker phases. One request cannot consume another request's results. A shared task gate is acquired before recording its input/loading its history, across chat and schedules. Timeout starts after waiting for that gate. Different tasks remain concurrent.

A small SQLite sidecar records requests/runs and submission receipts rather than migrating legacy stores. Repeating a submission ID retrieves the same request; different IDs preserve intentionally repeated messages. Restart marks unfinished work interrupted and does not resume it. Schedule receipts derive from trigger identity, exact owner and due occurrence; interrupted occurrences stay held. This is conservative duplicate prevention, not a guarantee of exactly-once external effects or multiprocess execution.

Failures stay failures even if a later model reply sounds successful. Completion requires a final reply after worker results, not an earlier progress acknowledgment. Clearing history rejects active writers; idle clear removes sidecar content while retaining content-free hashed submission tombstones to block accidental replay.

## Interface

The frontend keeps conversation central, with saved tasks beside it on desktop and in a dialog on mobile. The composer remains reachable. Request states are observable facts—queued, routing, working, preparing a response, completed, failed, interrupted—rather than invented private reasoning. Provider SSE is assembled server-side; the browser polls current worker output every 500 ms while work is pending. That output is bounded, labeled unfinished and removed on terminal status. Tool-call fragments and router/finalizer deliberation remain private. Real draft records show recipient, subject, body, Copy and Continue. “Not sent” applies to that draft record, not every Gmail tool action.

Acknowledged pending IDs survive browser reload; status for recent saved requests is also loaded so completed/failed states remain truthful. A compact message navigator jumps to the corresponding request. Active work groups concurrent requests without changing their composer targets; each still retains its own progress, output and failure. Unavailable polling is labeled last known, and timestamp/terminal guards reject delayed status regressions. A small escaped Markdown renderer supports lists, code and supplied HTTP(S) links. Links are not a source-verification or structured citation system. Exact draft-body duplicates within the same request are folded in the display while persisted history remains intact. A known HTTP rejection restores input; uncertain delivery is labeled and never automatically resent. A Base UI dialog provides focus trapping and dismissal for mobile navigation; native dialogs remain for settings and message navigation. Focus indicators and reduced-motion behavior remain. Kobra informed restraint and task presentation. Beautiful UI SidebarNav rail/recent rows and TaskRows status/disclosure structure are adapted with MIT attribution in THIRD_PARTY_NOTICES.md; demo timers, simulated recovery and additional dependencies are excluded. Sound remains optional future polish.

## Context and future scope

The desired long-term distinction is task → request → worker attempt → evidence/artifact, with summaries as derived views over preserved source records. This slice establishes request ownership without claiming a complete event ledger, rolling compaction or immutable artifact versioning. An existing incoming-email summary can enter with an event owner; no new webhook service or Gmail permission was added.

[Lost in the Middle](https://arxiv.org/abs/2307.03172) motivates separating context capacity from reliable use. [LongMemEval](https://arxiv.org/abs/2410.10813) motivates testing temporal and multi-session retrieval. These research ideas motivated the scope; they do not prove routing accuracy here.

Further work should broaden the small live routing evaluation and define approval semantics for external tools, then durable recovery and context summaries if the measurements justify them. Webhooks, vector services, additional providers and a broad agent platform were deliberately left outside this build. The original total time allowance included exploration; elapsed time was not reconstructed, so this broader approved slice is not presented as meeting an unverified 6–8-hour cap.

## Evidence

See [validation](validation.md). Offline tests, fixture browser results and live model results are separate evidence categories. The approved no-Gmail test used a capped OpenRouter harness and fictional histories. Two successful cases verified exact task ownership and provisional output, while earlier attempts exposed provider errors, incorrect draft roles and routing that skipped a worker. Prompt changes improved those sampled cases; they do not establish general model reliability. No real email, calendar action, push, deployment or submission occurred.


## Dependency boundary

A critical Next.js advisory could not be addressed within Next 14. The smallest supported update used Next 15.5.27, React 19.2.8 and two awaited dynamic-route parameter signatures, keeping the current UI structure. Production dependencies now have no reported audit vulnerabilities. Development/build-tool advisories remain; a Tailwind/toolchain rewrite was deferred because it would widen this take-home slice without improving the task-continuity behavior.

## Task-workspace refinement

Saved task selection is a read-only main-pane timeline. Legacy worker logs lack the correlation and draft-state fields needed to safely reconstruct a full conversation; explicit Continue returns to the general conversation with an exact target. This makes the boundary understandable without migrating or inventing persisted records. Email-shaped worker text is formatted as a saved response, while only actual conversation draft records say Not sent. Loaded list pages are refreshed together, preserving search, selection and the number of loaded rows when other work finishes.

One read-only exact task metadata endpoint supplies old draft display names without loading the whole roster or invoking a model. Backend resolution still validates the authoritative legacy name. A continuation generation guard prevents a delayed lookup from overriding a newer task choice. This refinement does not change worker execution, scheduling or the router's bounded context.

Scroll following uses one state and ResizeObserver over committed content and viewport changes. It uses immediate anchoring instead of overlapping smooth animations; deliberate reading above the latest result is preserved. The composer returns focus after acknowledged or rejected sending unless the user moved focus elsewhere. Failed/unknown mode detection blocks dispatch, and Demo/isolated model modes skip Gmail status and connection actions. The dependency cost is Base UI's dialog implementation; the earlier page reported 139kB first-load JavaScript in the production build. Further device and screen-reader testing remains necessary before claiming that coverage.


## Composed UI and recent history

The approved composed pass adapts Beautiful UI Prompt Bar, Chat/Streaming Text, Selection Actions, Recommendation Card, local prompt-review and Filter Table, alongside the existing Sidebar Nav and Task Rows. Lucide and Sonner add two pinned dependencies; the page now reports 156kB first-load JavaScript, up from 139kB. This is a UI capability cost, not a claimed speed improvement. Components dispatch only through existing app actions. The local review card does not enforce external-tool approval, and the activity table contains only loaded request receipts. See [component guide](composed-ui.md).

Saved history now starts with a bounded newest suffix and exclusive earlier-record cursor. A streaming file scan retains bounded display records without migrating legacy logs; scan time still grows with file length. The frontend merges refresh pages and anchors the visible row. This improves access to the latest outcome while preserving storage, worker execution and the offset API. Full worker prompt history remains unbounded.


## Email-shaped outputs

One presentation adapter handles conversation drafts, saved worker replies and provisional output. It recognizes only a complete leading To/Subject block with a nonempty body and displays supplied metadata without inferring send status. Conversation draft records say Not sent; generic/saved output says Delivery not tracked. The original copy text and histories remain unchanged. This is deliberately smaller than a MIME parser or mailbox-thread model: it does not reconstruct replies, provider thread IDs, attachments or delivery evidence. Beautiful UI's existing Chat/StreamingText composition is retained; no additional dependency was installed.
