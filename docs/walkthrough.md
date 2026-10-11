# Five-minute take-home walkthrough

Use the explicitly labeled Offline demo at localhost:3000 for the interface walkthrough. Its replies are scripted. Run separately approved isolated model tests to discuss live routing evidence; neither mode connects Gmail.

1. **Problem (30 seconds).** The original router received the complete saved worker roster every turn. More tasks made that directory grow linearly. The fix bounds its initial view to eight entries/4096 serialized UTF-8 bytes while retaining paginated search over all workers. This does not bound whole worker history.
2. **Email and continuation (90 seconds).** Open Sample · Reply to Nora, inspect its saved history, and choose Continue this task. Send “Make it shorter and say Friday works.” Show the exact target chip, actual request status, email subject/recipient/body and Copy action. Older replies remain saved. Draft records say Not sent; worker history alone cannot establish delivery.
3. **Separate work and failure (60 seconds).** Remove the target and start a slow book-club task. Start a subscription-review task separately. Show two request-owned workers and inspect one while the other runs. Include “fail” in a fictional request to show a persistent failure. Do not clear history or connect integrations.
4. **Code map (90 seconds).** Follow the table below. Explain why requests own results, why the same task is serialized, and why restart records interruption rather than replaying external effects.
5. **Evidence and tradeoffs (30 seconds).** Show the latest final-check receipt and the separate live-model receipt. Fresh installation passed 55 backend and 33 browser checks; the final source passed 36 browser checks plus build/lint/types, with 55 backend tests rerun at the commit gate. The live sample remains small. Lexical names can miss paraphrases; full history and durable automatic recovery remain outside this slice. No measured before/after latency or general accuracy improvement is claimed.

| Concern | Start reading | What it owns |
| --- | --- | --- |
| Interface and explicit continuation | `web/app/page.tsx`, `web/components/tasks/TaskHistory.tsx` | Target ID, polling, history selection, composer |
| Email presentation | `web/components/ui/StreamingReply.tsx`, `EmailReply.tsx` | Supplied header/body rendering only |
| API acceptance | `server/routes/chat.py` | Validated input and request acknowledgment |
| Request and attempt ownership | `server/services/execution/request_coordinator.py`, `request_store.py` | Phases, deduplication, terminal state, restart interruption |
| Routing context and discovery | `server/agents/interaction_agent/agent.py`, `tools.py`, `server/services/execution/directory.py` | Bounded shortlist, full lookup, authoritative task resolution |
| Worker execution | `server/agents/execution_agent/batch_manager.py`, `runtime.py` | Shared task gate, retained history, tools and worker result |
| Received provisional text | `server/openrouter_client/client.py` | Provider stream aggregation; browser receives bounded status snapshots |
| Scheduled occurrences | `server/services/trigger_scheduler.py` | Existing trigger ownership and shared request/task gates |

After the demo, discuss: Why lexical lookup rather than a vector service? Why an exact Continue target? What would be required for mailbox approvals, webhook ingestion, rolling summaries or automatic recovery? [Tradeoffs](tradeoffs.md) records these limits. The local branch still needs a reviewed commit and authorized publication.


## Current real-model trial

Open http://127.0.0.1:3016/ and confirm Live model test / US$5 cap. Use Nora interview draft → Continue this task → “Make Friday work and ask Nora to suggest a time. Draft only.” Then remove the target before starting a separate task. Replies are real model output; Gmail, reminders and external research are unavailable. Drafting is available. At initial handoff the shared receipt has 11 calls / US$2.20 reservation remaining; one interaction can use several calls. Temporary records disappear when the isolated backend stops, while the budget receipt survives. Ask for a useful task, inspect its answer and follow-up ownership, and record any misleading or unrelated output for the discussion. The Portugal paraphrase lookup already failed; do not present it as solved.
