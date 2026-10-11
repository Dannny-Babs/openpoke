import { RefObject, useState } from "react";
import type { ChatBubble, RequestState, TaskTarget } from "./types";
import { TaskRow, TASK_STATUS_LABELS as labels } from "../ui/TaskRow";
import { StreamingReply } from "../ui/StreamingReply";
import { RecommendationCard } from "../ui/RecommendationCard";
import type { PromptExcerpt } from "../ui/PromptReviewCard";
import { Copy, ArrowUpRight, MessageCircle, ArrowDown } from "lucide-react";
import { toast } from "sonner";
import { parseEmail } from "../ui/EmailReply";
interface Props {
  activeTaskId?: string;
  away: boolean;
  onLatest: () => void;
  messages: ReadonlyArray<ChatBubble>;
  isWaitingForResponse: boolean;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  onScroll: () => void;
  onContinue: (task: TaskTarget) => void;
  requests: Record<string, RequestState>;
  onUsePrompt: (text: string) => void;
  onAsk: (excerpt: PromptExcerpt) => void;
  pending: string[];
  statusErrors: Record<string, string>;
  onReloadStatus: () => void;
}
export function ChatMessages({
  activeTaskId,
  away,
  onLatest,
  messages,
  scrollContainerRef,
  onScroll,
  onContinue,
  requests,
  onUsePrompt,
  onAsk,
  pending,
  statusErrors,
  onReloadStatus,
}: Props) {
  const [copied, setCopied] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  async function copy(message: ChatBubble) {
    try {
      await navigator.clipboard.writeText(message.text);
      setCopied(message.id);
      toast.success(message.role === "draft" ? "Draft copied" : "Reply copied");
      setCopyError(null);
    } catch {
      setCopyError("Could not copy. Select the text to copy it.");
    }
  }
  function scroll() {
    onScroll();
  }
  function latest() {
    onLatest();
  }
  const draftRequests = new Map<string, Set<string | undefined>>();
  for (const message of messages) {
    if (message.role !== "draft" || !message.requestId) continue;
    const tasks = draftRequests.get(message.requestId) || new Set<string | undefined>();
    tasks.add(message.taskId);
    draftRequests.set(message.requestId, tasks);
  }
  const isDraftCommentary = (message: ChatBubble) => message.role === "assistant" && Boolean(
    message.requestId && draftRequests.has(message.requestId) &&
    (!message.taskId || draftRequests.get(message.requestId)?.has(message.taskId))
  );
  const draftBodies = new Map<string, Set<string>>();
  for (const message of messages) {
    if (message.role !== "draft" || !message.requestId) continue;
    const body = parseEmail(message.text)?.body;
    if (!body) continue;
    const normalized = body.replace(/\s+/g, " ").trim();
    if (!normalized) continue;
    const bodies = draftBodies.get(message.requestId) || new Set<string>();
    bodies.add(normalized);
    draftBodies.set(message.requestId, bodies);
  }
  const isDraftEcho = (message: ChatBubble) =>
    message.role === "assistant" &&
    Boolean(
      message.requestId &&
        draftBodies
          .get(message.requestId)
          ?.has(message.text.replace(/\s+/g, " ").trim()),
    );
  const associated = new Set(
    messages
      .filter((message) => message.role === "user")
      .map((message) => message.requestId),
  );
  const recovered = Object.values(requests).filter(
    (request) =>
      !associated.has(request.request_id) &&
      (pending.includes(request.request_id) ||
        request.status === "failed" ||
        request.status === "interrupted"),
  );
  return (
    <div className="thread-region">
      <div
        ref={scrollContainerRef}
        onScroll={scroll}
        className="message-scroll"
        aria-label="Conversation"
      >
        <div className="message-content">
          {messages.length === 0 && (
            <div className="empty-state">
              <span className="empty-mark" aria-hidden="true">
                <MessageCircle size={26} strokeWidth={1.3} />
              </span>
              <h2>
                What can I take
                <br />
                off your plate?
              </h2>
              <p>
                Ask for something useful. Pick up the same task whenever you
                need it.
              </p>
              <RecommendationCard onChoose={onUsePrompt} />
            </div>
          )}
          {copyError && (
            <p className="notice" role="status">
              {copyError}
            </p>
          )}
          {messages.map((message, index) =>
            isDraftEcho(message) ? null : (
              <article
                key={message.id}
                id={`chat-message-${index}`}
                data-task-id={message.taskId}
                data-task-name={Object.values(requests).flatMap(request => request.runs).find(run => run.task_id === message.taskId)?.task_name}
                tabIndex={-1}
                className={`message-turn ${message.role === "user" ? "user-turn" : "assistant-turn"}`}
              >
                {message.role === "user" ? (
                  <>
                    <div className="user-message">
                      {message.text}
                      {message.deliveryUnconfirmed && (
                        <p className="delivery-note">
                          Delivery unconfirmed · Local message
                        </p>
                      )}
                    </div>
                    {message.requestId && (
                      <RequestProgress
                        request={requests[message.requestId]}
                        hasDraft={draftRequests.has(message.requestId)}
                        pending={pending.includes(message.requestId)}
                        error={statusErrors[message.requestId]}
                        onReload={onReloadStatus}
                      />
                    )}
                  </>
                ) : (
                  <div
                    className={
                      message.role === "draft"
                        ? "draft-result"
                        : "assistant-result"
                    }
                  >
                    <StreamingReply text={message.text} emailDraft={message.role === "draft"} />
                    {!isDraftCommentary(message) && <div className="message-actions">
                      <button
                        className="text-button"
                        onClick={() => void copy(message)}
                        aria-label={
                          message.role === "draft" ? "Copy draft" : "Copy reply"
                        }
                      >
                        <Copy size={14} aria-hidden />{message.role === "draft" ? "Copy draft" : <span className="sr-only">Copy reply</span>}
                      </button>
                      {message.role === "draft" && message.taskId && message.taskId !== activeTaskId && (
                        <button
                          className="text-button"
                          onClick={() =>
                            onContinue({
                              id: message.taskId!,
                              name:
                                Object.values(requests)
                                  .flatMap((request) => request.runs)
                                  .find((run) => run.task_id === message.taskId)
                                  ?.task_name || "Saved task",
                            })
                          }
                        >
                          Continue this task <ArrowUpRight size={14} aria-hidden />
                        </button>
                      )}
                      {message.role !== "draft" && <button className="text-button" onClick={() => onAsk({ text: message.text.slice(0,2000), taskId: message.taskId, taskName: Object.values(requests).flatMap(request => request.runs).find(run => run.task_id === message.taskId)?.task_name })}><MessageCircle size={14} aria-hidden />Ask about reply</button>}
                    </div>}
                  </div>
                )}
              </article>
            ),
          )}
          {recovered.map((request) => (
            <div key={request.request_id} className="recovered-request">
              <p>Earlier request</p>
              <RequestProgress
                request={request}
                error={statusErrors[request.request_id]}
                onReload={onReloadStatus}
              />
            </div>
          ))}
        </div>
      </div>
      {away && (
        <button className="latest-button quiet-button" onClick={latest}>
          Latest <ArrowDown size={14} aria-hidden />
        </button>
      )}
      <span className="sr-only" role="status">
        {copied ? "Text copied." : ""}
      </span>
    </div>
  );
}
function RequestProgress({
  request,
  error,
  onReload,
  pending = false,
  hasDraft = false,
}: {
  request?: RequestState;
  error?: string;
  onReload: () => void;
  pending?: boolean;
  hasDraft?: boolean;
}) {
  if (!request && !error)
    return (
      <p className="request-received" role="status">
        {pending ? "Request received" : "Saved request · Status unavailable"}
      </p>
    );
  const complete = request?.status === "succeeded";
  return (
    <div className={`inline-task-status ${complete ? "complete" : ""}`}>
      {request && (
        <TaskRow
          label={request.runs.map((run) => run.task_name).join(", ") || "Your request"}
          status={request.status}
          statusLabel={hasDraft && request.status === "failed" ? "Draft saved · Reply incomplete" : undefined}
          stale={Boolean(error)}
          initiallyExpanded={!complete}
          expandable={Boolean((hasDraft && request.status === "failed") || request.error || request.partial_response || request.runs.length > 1 || request.runs.some(run => run.activity || run.error || run.partial_response))}
        >
          {hasDraft && request.status === "failed" && <p className="request-explanation">Your draft is saved. The agent could not finish its follow-up response.</p>}
          {request.error && <p className="request-error">{request.error}</p>}
          {request.runs.map((run) => (
            <div key={run.id} className="run-activity">
              {request.runs.length > 1 && <p className="tool-activity"><span>{run.task_name}</span><small>{`${error ? "Last known: " : ""}${labels[run.status]}`}</small></p>}
              {run.activity && (
                <p className="tool-activity">
                  {run.activity.name}
                  <small>{`${error ? "Last known: " : ""}${run.activity.status === "running" ? "In progress" : run.activity.status === "succeeded" ? "Done" : "Failed"}`}</small>
                </p>
              )}
              {run.error && <p className="request-error">{run.error}</p>}
              {run.partial_response && (
                <section className="working-output">
<StreamingReply text={run.partial_response} provisional stale={Boolean(error)} />
                </section>
              )}
            </div>
          ))}
          {request.partial_response && (
            <section className="working-output">
<StreamingReply text={request.partial_response} provisional stale={Boolean(error)} />
            </section>
          )}
        </TaskRow>
      )}
      {error && (
        <p className="request-error">
          {request
            ? "Status unavailable"
            : "Saved request · Status unavailable"}
          : {error}
          <button className="text-button" onClick={onReload}>
            Reload status
          </button>
        </p>
      )}
    </div>
  );
}
