"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import SettingsModal, { useSettings } from "@/components/SettingsModal";
import { ChatHeader } from "@/components/chat/ChatHeader";
import { ChatInput } from "@/components/chat/ChatInput";
import { ActiveWork } from "@/components/chat/ActiveWork";
import { MessageNavigator } from "@/components/chat/MessageNavigator";
import { ChatMessages } from "@/components/chat/ChatMessages";
import { ErrorBanner } from "@/components/chat/ErrorBanner";
import { useAutoScroll } from "@/components/chat/useAutoScroll";
import { TaskDrawer, type SavedTask } from "@/components/tasks/TaskDrawer";
import { ActivityTable } from "@/components/ui/ActivityTable";
import { PromptReviewCard, type PromptExcerpt } from "@/components/ui/PromptReviewCard";
import { SelectionActions } from "@/components/ui/SelectionActions";
import { toast } from "sonner";
import { ArrowUpRight } from "lucide-react";
import { TaskHistory } from "@/components/tasks/TaskHistory";
import { shouldAcceptStatus } from "@/components/chat/requestStatus";
import type {
  ChatBubble,
  RequestState,
  TaskTarget,
} from "@/components/chat/types";
class RejectedSubmission extends Error {}
const STORAGE = "openpoke.pending.v1";
const terminal = (status: string) =>
  ["succeeded", "failed", "interrupted"].includes(status);
const statusLabels: Record<string, string> = {
  queued: "Queued",
  routing: "Finding the right task",
  running: "Working",
  responding: "Preparing a response",
  succeeded: "Completed",
  failed: "Failed",
  interrupted: "Interrupted",
};
function bubbles(data: {
  messages?: Array<{
    id?: string;
    role: string;
    content: string;
    request_id?: string;
    task_id?: string;
  }>;
}): ChatBubble[] {
  return (data.messages || [])
    .filter(
      (message) =>
        typeof message.content === "string" && message.content.trim(),
    )
    .map((message, index) => ({
      id: message.id || `history-${index}`,
      role: message.role,
      text: message.content,
      requestId: message.request_id,
      taskId: message.task_id,
    }));
}
export default function Page() {
  const { settings, setSettings } = useSettings();
  const [activityOpen, setActivityOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [demo, setDemo] = useState(true);
  const [modeReady, setModeReady] = useState(false);
  const [modeError, setModeError] = useState(false);
  const [selectedTask, setSelectedTask] = useState<SavedTask | null>(null);
  const [liveTest, setLiveTest] = useState(false);
  const [liveBudgetUsd, setLiveBudgetUsd] = useState<number | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/preview", { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw Error("Mode unavailable");
        return response.json();
      })
      .then((data) => {
        if (
          typeof data.demo !== "boolean" ||
          typeof data.liveTest !== "boolean"
        )
          throw Error("Mode unavailable");
        if (!controller.signal.aborted) {
          setDemo(data.demo === true);
          setLiveTest(data.liveTest === true);
          setLiveBudgetUsd(data.budgetUsd === 2 || data.budgetUsd === 5 ? data.budgetUsd : null);
          setModeReady(true);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setModeError(true);
      });
    return () => controller.abort();
  }, []);
  const [tasksOpen, setTasksOpen] = useState(false);
  const [target, setTarget] = useState<TaskTarget | null>(null);
  const [resolvingTask, setResolvingTask] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [input, setInput] = useState("");
  const [excerpt, setExcerpt] = useState<PromptExcerpt | null>(null);
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState<ChatBubble[]>([]);
  const [optimistic, setOptimistic] = useState<ChatBubble[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [pending, setPending] = useState<string[]>([]);
  const [requests, setRequests] = useState<Record<string, RequestState>>({});
  const [statusErrors, setStatusErrors] = useState<Record<string, string>>({});
  const [refresh, setRefresh] = useState(0);
  const mounted = useRef(true);
  const sendControllers = useRef(new Set<AbortController>());
  useEffect(() => {
    mounted.current = true;
    const controllers = sendControllers.current;
    return () => {
      mounted.current = false;
      controllers.forEach((controller) => controller.abort());
    };
  }, []);
  const visible = useMemo(
    () => [
      ...messages,
      ...optimistic.filter(
        (message) =>
          !message.requestId ||
          !messages.some(
            (saved) =>
              saved.role === "user" && saved.requestId === message.requestId,
          ),
      ),
    ],
    [messages, optimistic],
  );
  const waiting = pending.length > 0;
  const { scrollContainerRef, handleScroll, scrollToBottom, away } =
    useAutoScroll({
      items: visible,
      isWaiting: waiting,
      scopeKey: selectedTask?.id || "all",
    });
  const loadHistory = useCallback(async (signal: AbortSignal) => {
    try {
      const response = await fetch("/api/chat/history", {
        cache: "no-store",
        signal,
      });
      if (!response.ok) throw new Error("Could not load the conversation.");
      const data = await response.json();
      if (!Array.isArray(data.messages))
        throw new Error("Conversation history was unavailable.");
      if (!signal.aborted) {
        setMessages((previous) => {
          const next = bubbles(data);
          return JSON.stringify(previous) === JSON.stringify(next)
            ? previous
            : next;
        });
        setHistoryError(null);
      }
    } catch (cause) {
      if (!signal.aborted)
        setHistoryError(
          cause instanceof Error
            ? cause.message
            : "Could not load conversation.",
        );
    } finally {
      if (!signal.aborted) setHistoryLoading(false);
    }
  }, []);
  useEffect(() => {
    try {
      const ids: unknown = JSON.parse(localStorage.getItem(STORAGE) || "[]");
      if (Array.isArray(ids))
        setPending(
          ids
            .filter(
              (id): id is string =>
                typeof id === "string" && /^[a-f0-9-]{36}$/i.test(id),
            )
            .slice(0, 100),
        );
    } catch {
      /* Storage may be unavailable. */
    }
  }, []);
  // Persist acknowledged identities only; never store message content or credentials.
  const remember = useCallback((ids: string[]) => {
    try {
      localStorage.setItem(STORAGE, JSON.stringify(ids));
    } catch {
      /* Recovery unavailable in restricted storage. */
    }
  }, []);
  const latestSnapshots = useRef<Record<string, RequestState>>({});
  const acceptSnapshot = useCallback((snapshot: RequestState) => {
    const current = latestSnapshots.current[snapshot.request_id];
    if (!shouldAcceptStatus(current, snapshot)) return false;
    latestSnapshots.current[snapshot.request_id] = snapshot;
    setRequests((previous) => ({
      ...previous,
      [snapshot.request_id]: snapshot,
    }));
    return true;
  }, []);
  const hydratedRequests = useRef(new Set<string>());
  const recentRequestIds = messages
    .filter((message) => message.role === "user" && message.requestId)
    .slice(-30)
    .map((message) => message.requestId!);
  const historyRequestKey = recentRequestIds.join(",");
  useEffect(() => {
    const controller = new AbortController();
    const cache = hydratedRequests.current;
    const ids = historyRequestKey ? historyRequestKey.split(",") : [];
    const allowed = new Set(ids);
    // Keep only recent terminal records; active requests remain recoverable.
    cache.forEach((id) => {
      if (!allowed.has(id)) cache.delete(id);
    });
    setRequests((previous) =>
      Object.fromEntries(
        Object.entries(previous).filter(
          ([id, request]) => allowed.has(id) || !terminal(request.status),
        ),
      ),
    );
    const inFlight = new Set<string>();
    void Promise.all(
      ids
        .filter((id) => !cache.has(id))
        .map(async (id) => {
          cache.add(id);
          inFlight.add(id);
          try {
            const response = await fetch(`/api/chat/requests/${id}`, {
              cache: "no-store",
              signal: controller.signal,
            });
            const data = await response.json();
            if (
              !response.ok ||
              data.request_id !== id ||
              !statusLabels[data.status] ||
              !Array.isArray(data.runs)
            )
              throw new Error("Saved request status is unavailable.");
            if (controller.signal.aborted) return;
            if (!acceptSnapshot(data)) return;
            setStatusErrors((previous) => {
              const next = { ...previous };
              delete next[id];
              return next;
            });
            setPending((previous) => {
              const next = terminal(data.status)
                ? previous.filter((value) => value !== id)
                : [...new Set([...previous, id])];
              remember(next);
              return next;
            });
          } catch {
            if (!controller.signal.aborted)
              setStatusErrors((previous) => ({
                ...previous,
                [id]: "Saved request status is unavailable.",
              }));
          } finally {
            if (!controller.signal.aborted) inFlight.delete(id);
          }
        }),
    );
    return () => {
      controller.abort();
      inFlight.forEach((id) => cache.delete(id));
    };
  }, [historyRequestKey, remember, refresh, acceptSnapshot]);
  const pendingKey = pending.join(",");
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      await Promise.all(
        pending.map(async (id) => {
          try {
            const response = await fetch(`/api/chat/requests/${id}`, {
              cache: "no-store",
              signal: controller.signal,
            });
            const data = await response.json();
            if (!response.ok)
              throw new Error(
                data.error || data.detail || "Status unavailable.",
              );
            if (
              data.request_id !== id ||
              !statusLabels[data.status] ||
              !Array.isArray(data.runs)
            )
              throw new Error("Unexpected request status.");
            if (controller.signal.aborted) return;
            if (!acceptSnapshot(data)) return;
            setStatusErrors((previous) => {
              const next = { ...previous };
              delete next[id];
              return next;
            });
            if (terminal(data.status)) {
              setPending((previous) => {
                const next = previous.filter((value) => value !== id);
                remember(next);
                return next;
              });
              setRefresh((value) => value + 1);
            }
          } catch (cause) {
            if (!controller.signal.aborted)
              setStatusErrors((previous) => ({
                ...previous,
                [id]:
                  cause instanceof Error
                    ? cause.message
                    : "Status unavailable.",
              }));
          }
        }),
      );
      await loadHistory(controller.signal);
      if (!controller.signal.aborted)
        timer = setTimeout(poll, pending.length ? 500 : 2000);
    }
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
    // pendingKey identifies the exact set being monitored.
  }, [pendingKey, pending, refresh, loadHistory, remember, acceptSnapshot]);
  useEffect(() => {
    if (!modeReady || demo || liveTest || settings.timezone) return;
    const controller = new AbortController();
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    void fetch("/api/timezone", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timezone }),
      signal: controller.signal,
    })
      .then((response) => {
        if (response.ok && !controller.signal.aborted)
          setSettings({ ...settings, timezone });
      })
      .catch(() => {});
    return () => controller.abort();
  }, [settings, setSettings, modeReady, demo, liveTest]);
  const continuationVersion = useRef(0);
  async function continueTask(task: TaskTarget) {
    const version = ++continuationVersion.current;
    setResolvingTask(task.name === "Saved task");
    if (task.name === "Saved task") {
      try {
        const response = await fetch(`/api/tasks/${task.id}`, {
          cache: "no-store",
        });
        const record = await response.json();
        if (
          !response.ok ||
          record.id !== task.id ||
          typeof record.name !== "string" ||
          record.history_ambiguous
        )
          throw Error(
            "This saved task could not be safely continued. Find it in saved work and review its history.",
          );
        task = {
          id: record.id,
          name: record.name + (record.name_truncated ? "…" : ""),
        };
      } catch (cause) {
        if (mounted.current && version === continuationVersion.current)
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not look up this task.",
          );
        if (mounted.current && version === continuationVersion.current)
          setResolvingTask(false);
        return;
      }
    }
    if (!mounted.current || version !== continuationVersion.current) return;
    setResolvingTask(false);
    setSelectedTask(null);
    setTarget(task);
    setExcerpt(current => current?.taskId && current.taskId !== task.id ? null : current);
    setTasksOpen(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  }
  async function submit() {
    if (!modeReady || resolvingTask || !input.trim() || sending) return;
    const text = input.trim();
    const focusOwner = document.activeElement;
    const restoreFocus =
      focusOwner === inputRef.current ||
      (focusOwner instanceof HTMLElement &&
        focusOwner.closest(".composer") !== null);
    const submissionId = crypto.randomUUID();
    const controller = new AbortController();
    sendControllers.current.add(controller);
    scrollToBottom();
    setSelectedTask(null);
    setSending(true);
    setInput("");
    setError(null);
    setOptimistic((previous) => [
      ...previous,
      { id: submissionId, role: "user", text },
    ]);
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: text }],
          submission_id: submissionId,
          ...(target ? { task_id: target.id } : {}),
        }),
        signal: controller.signal,
      });
      const data = await response
        .json()
        .catch(() => ({ error: `Server returned HTTP ${response.status}.` }));
      if (!response.ok) {
        const detail =
          data.error ||
          data.detail ||
          "The server did not accept this request.";
        if (response.status >= 400 && response.status < 500)
          throw new RejectedSubmission(detail);
        throw new Error(detail);
      }
      if (
        typeof data.request_id !== "string" ||
        !/^[a-f0-9-]{36}$/i.test(data.request_id)
      )
        throw new Error("The server returned no request identity.");
      if (!mounted.current) return;
      setOptimistic((previous) =>
        previous.map((message) =>
          message.id === submissionId
            ? {
                ...message,
                requestId: data.request_id,
                taskId: data.task_id || undefined,
              }
            : message,
        ),
      );
      setPending((previous) => {
        const next = [...new Set([...previous, data.request_id])];
        remember(next);
        return next;
      });
    } catch (cause) {
      if (mounted.current) {
        if (cause instanceof RejectedSubmission) {
          setOptimistic((previous) =>
            previous.filter((message) => message.id !== submissionId),
          );
          setInput((previous) => previous || text);
          setError(`Request rejected: ${cause.message}`);
        } else {
          setOptimistic((previous) =>
            previous.map((message) =>
              message.id === submissionId
                ? { ...message, deliveryUnconfirmed: true }
                : message,
            ),
          );
          setError(
            `Delivery unconfirmed: ${cause instanceof Error ? cause.message : "No acknowledgement was received."} Check the conversation before sending again. No automatic retry was made.`,
          );
        }
      }
    } finally {
      sendControllers.current.delete(controller);
      if (mounted.current) {
        setSending(false);
        if (
          restoreFocus &&
          (document.activeElement === focusOwner ||
            document.activeElement === document.body)
        )
          requestAnimationFrame(() => inputRef.current?.focus());
      }
    }
  }
  async function clearHistory() {
    if (
      !window.confirm(
        "Clear all chat, saved task history and reminders? This cannot be undone.",
      )
    )
      return;
    try {
      const response = await fetch("/api/chat/history", { method: "DELETE" });
      if (!response.ok) throw new Error("Could not clear history.");
      setMessages([]);
      setOptimistic([]);
      setPending([]);
      setRequests({});
      latestSnapshots.current = {};
      hydratedRequests.current.clear();
      setStatusErrors({});
      continuationVersion.current++;
      setResolvingTask(false);
      setTarget(null);
      setSelectedTask(null);
      setHistoryOpen(false);
      remember([]);
      setRefresh((value) => value + 1);
    } catch {
      setError("Could not clear history.");
    }
  }
  return (
    <main className="chat-bg">
      <div className="chat-wrap">
        <ChatHeader
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenActivity={() => setActivityOpen(true)}
          onOpenTasks={() => setTasksOpen(true)}
          tasksOpen={tasksOpen}
          onOpenHistory={() => setHistoryOpen(true)}
        />
        {liveTest && (
          <p className="demo-banner" role="status">
            Live model test · Temporary data · Gmail disabled · {liveBudgetUsd ? `US$${liveBudgetUsd} cap` : "Budget capped"}
          </p>
        )}
        {!modeReady && (
          <p className="demo-banner" role={modeError ? "alert" : "status"}>
            {modeError
              ? "Could not verify app mode. Reload before sending; integration actions are disabled."
              : "Checking app mode…"}
          </p>
        )}
        {modeReady && demo && !liveTest && (
          <p className="demo-banner" role="status">
            Offline demo · Responses are scripted. No model or mailbox
            connection.
          </p>
        )}
        <div className="workspace">
          <TaskDrawer
            composerRef={inputRef}
            open={tasksOpen}
            onClose={() => setTasksOpen(false)}
            selectedId={selectedTask?.id}
            onSelect={(task) => {
              continuationVersion.current++;
              setResolvingTask(false);
              if (task.id !== selectedTask?.id) setExcerpt(null);
              setSelectedTask(task);
            }}
            onNewTask={() => {
              continuationVersion.current++;
              setResolvingTask(false);
              setSelectedTask(null);
              setTarget(null);
              setExcerpt(null);
              inputRef.current?.focus();
            }}
            onAllMessages={() => { setSelectedTask(null); setExcerpt(null); }}
            refreshKey={refresh}
          />
          <section
            className="conversation-card"
            aria-label="Conversation workspace"
          >
            <header className="conversation-heading">
              <div>
                <h1>{selectedTask?.name || target?.name || "All messages"}</h1>
                <p className="supporting-text">
                  {selectedTask
                    ? "Your conversation with this task."
                    : target
                      ? "Continuing this task"
                      : "Ask, review, and pick things up."}
                </p>
              </div>
              {selectedTask && (
                <button
                  className="quiet-button"
                  disabled={selectedTask.history_ambiguous}
                  onClick={() => continueTask(selectedTask)}
                >
                  Continue this task <ArrowUpRight size={15} aria-hidden />
                </button>
              )}
            </header>
            {historyLoading && (
              <p className="loading-note" role="status">
                Loading conversation…
              </p>
            )}
            {historyError && (
              <div className="notice">
                <p role="alert">{historyError}</p>
                <button
                  className="text-button"
                  onClick={() => setRefresh((value) => value + 1)}
                >
                  Reload conversation
                </button>
              </div>
            )}
            <ActiveWork
              messages={visible}
              requests={requests}
              statusErrors={statusErrors}
              onViewRequest={(index) => {
                setSelectedTask(null);
                requestAnimationFrame(() =>
                  requestAnimationFrame(() => {
                    const element = document.getElementById(
                      `chat-message-${index}`,
                    );
                    element?.scrollIntoView({ block: "center" });
                    element?.focus({ preventScroll: true });
                  }),
                );
              }}
            />
            <SelectionActions onAsk={setExcerpt}>
            {selectedTask ? (
              <TaskHistory
                key={selectedTask.id}
                task={selectedTask}
                refreshKey={refresh}
                onAsk={(text) => setExcerpt({text, taskId: selectedTask.id, taskName: selectedTask.name})}
              />
            ) : (
              <ChatMessages
                away={away}
                onLatest={() => scrollToBottom()}
                messages={visible}
                isWaitingForResponse={false}
                scrollContainerRef={scrollContainerRef}
                onScroll={handleScroll}
                onContinue={continueTask}
                activeTaskId={target?.id}
                requests={requests}
                onUsePrompt={(text) => { setInput(text); inputRef.current?.focus(); }}
                onAsk={setExcerpt}
                pending={pending}
                statusErrors={statusErrors}
                onReloadStatus={() => {
                  hydratedRequests.current.clear();
                  setRefresh((value) => value + 1);
                }}
              />
            )}
            </SelectionActions>
            <div className="composer">
              {excerpt && <PromptReviewCard key={`${excerpt.taskId || "conversation"}:${excerpt.text}`} excerpt={excerpt} onDismiss={() => setExcerpt(null)} onAdd={(instruction) => {
                const context = `${instruction}:\n\n> ${excerpt.text}`;
                setInput(value => value.trim() ? `${value}\n\n${context}` : context);
                if (excerpt.taskId) void continueTask({id: excerpt.taskId, name: excerpt.taskName || "Saved task"});
                setExcerpt(null);
                requestAnimationFrame(() => inputRef.current?.focus());
              }} />}
              {resolvingTask && (
                <p className="supporting-text" role="status">
                  Finding the saved task…
                </p>
              )}
              {error && (
                <ErrorBanner message={error} onDismiss={() => setError(null)} />
              )}
              <ChatInput
                onPickTask={continueTask}
                onOpenTasks={() => setTasksOpen(true)}
                onOpenSettings={() => setSettingsOpen(true)}
                mode={!modeReady ? "Checking mode" : liveTest ? "Model test" : demo ? "Offline demo" : "Live"}
                value={input}
                canSubmit={
                  modeReady &&
                  !resolvingTask &&
                  Boolean(input.trim()) &&
                  !sending
                }
                placeholder={
                  selectedTask && !target
                    ? "New request · Choose Continue above for a follow-up…"
                    : "Ask for something, or continue a task…"
                }
                onChange={setInput}
                onSubmit={submit}
                target={target}
                onClearTarget={() => {
                  continuationVersion.current++;
                  setResolvingTask(false);
                  setTarget(null);
                  setExcerpt(current => current?.taskId ? null : current);
                  inputRef.current?.focus();
                }}
                inputRef={inputRef}
              />
            </div>
          </section>
        </div>
        <MessageNavigator open={historyOpen} messages={visible} onClose={() => setHistoryOpen(false)} onJump={(index) => {
          setSelectedTask(null);
          setExcerpt(null);
          requestAnimationFrame(() => requestAnimationFrame(() => {
            const element = document.getElementById(`chat-message-${index}`);
            element?.scrollIntoView({block: "center"});
            element?.focus({preventScroll: true});
          }));
        }} />
        <ActivityTable open={activityOpen} onClose={() => setActivityOpen(false)} requests={requests} onView={(id) => {
        setActivityOpen(false); setSelectedTask(null); setExcerpt(null);
        const index = visible.findIndex(message => message.role === "user" && message.requestId === id);
        if (index >= 0) requestAnimationFrame(() => requestAnimationFrame(() => {
          const element = document.getElementById(`chat-message-${index}`); element?.scrollIntoView({block:"center"}); element?.focus({preventScroll:true});
        }));
      }} />
      <SettingsModal
          demo={demo || !modeReady}
          liveTest={liveTest}
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          settings={settings}
          onClearHistory={() => void clearHistory()}
          onSave={(value) => { setSettings(value); toast.success("Preferences saved"); }}
        />
      </div>
    </main>
  );
}
