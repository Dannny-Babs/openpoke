"use client";
import {
  FormEvent,
  RefObject,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { Search, X } from "lucide-react";
import { Dialog } from "@base-ui/react/dialog";
import { SidebarRailButton, SidebarRecentRows, SidebarIcon } from "../ui/SidebarRows";
import type { TaskTarget } from "../chat/types";
export type SavedTask = TaskTarget & {
  name_truncated: boolean;
  last_activity: string | null;
  history_ambiguous: boolean;
};
type TaskPage = {
  tasks: SavedTask[];
  total: number;
  next_cursor: string | null;
};
export function TaskDrawer({
  composerRef,
  open,
  onClose,
  onSelect,
  onNewTask,
  onAllMessages,
  selectedId,
  refreshKey = 0,
}: {
  composerRef: RefObject<HTMLTextAreaElement | null>;
  open: boolean;
  onClose: () => void;
  onSelect: (task: SavedTask) => void;
  onNewTask: () => void;
  onAllMessages: () => void;
  selectedId?: string;
  refreshKey?: number;
}) {
  const searchId = useId();
  const focusComposerOnClose = useRef(false);
  const [mobile, setMobile] = useState(false);
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState<TaskPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const pageRef = useRef<TaskPage | null>(null);
  useEffect(() => {
    const media = matchMedia("(max-width:800px)");
    const update = () => setMobile(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const load = useCallback(
    async (cursor?: string, refresh = false) => {
      controller.current?.abort();
      const pending = new AbortController();
      controller.current = pending;
      setLoading(true);
      setError(null);
      try {
        let result: TaskPage;
        const rows: SavedTask[] = [];
        let next = cursor;
        const desired = refresh
          ? Math.max(20, pageRef.current?.tasks.length || 20)
          : 20;
        do {
          const params = new URLSearchParams({ q: query });
          if (next) params.set("cursor", next);
          const response = await fetch("/api/tasks?" + params, {
            cache: "no-store",
            signal: pending.signal,
          });
          const data = await response.json();
          if (!response.ok)
            throw Error(
              data.error || data.detail || "Could not load saved tasks.",
            );
          if (!Array.isArray(data.tasks)) throw Error("Task list unavailable.");
          result = data;
          rows.push(...result.tasks);
          next = result.next_cursor || undefined;
        } while (refresh && next && rows.length < desired);
        if (!pending.signal.aborted) {
          const updated = {
            ...result!,
            tasks: cursor ? [...(pageRef.current?.tasks || []), ...rows] : rows,
          };
          pageRef.current = updated;
          setPage(updated);
        }
      } catch (cause) {
        if (!pending.signal.aborted)
          setError(
            cause instanceof Error ? cause.message : "Could not load tasks.",
          );
      } finally {
        if (!pending.signal.aborted) setLoading(false);
      }
    },
    [query],
  );
  useEffect(() => {
    pageRef.current = null;
    setPage(null);
    void load();
    return () => controller.current?.abort();
  }, [load]);
  const priorRefresh = useRef(refreshKey);
  useEffect(() => {
    if (priorRefresh.current !== refreshKey) {
      priorRefresh.current = refreshKey;
      void load(undefined, true);
    }
  }, [refreshKey, load]);
  function search(event: FormEvent) {
    event.preventDefault();
    if (query === input.trim()) void load(undefined, true);
    else setQuery(input.trim());
  }
  const content = (
    <>
      <div className="sidebar-controls">
        <div className="sidebar-heading">
          <h2>Workspace</h2>
          {mobile && (
            <Dialog.Close
              className="text-button"
              aria-label="Close saved tasks"
            >
              Close
            </Dialog.Close>
          )}
        </div>
        <SidebarRailButton
          className="new-task-button"
          icon={<SidebarIcon kind="new" />}
          label="New task"
          onClick={() => { focusComposerOnClose.current = mobile; onNewTask(); onClose(); }}
        />
        <SidebarRailButton
          className="all-messages"
          icon={<SidebarIcon kind="messages" />}
          label="All messages"
          active={!selectedId}
          onClick={() => { onAllMessages(); onClose(); }}
        />
        <form className="task-search beautiful-search" onSubmit={search}>
          <Search size={16} className="search-leading" aria-hidden />
          <label className="sr-only" htmlFor={searchId}>
            Search saved tasks
          </label>
          <input
            id={searchId}
            type="search"
            className="input"
            placeholder="Find saved work…"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            maxLength={2048}
          />
          {input && <button type="button" className="icon-button" aria-label="Clear task search" onClick={() => { setInput(""); setQuery(""); }}><X size={13} aria-hidden /></button>}
          <button
            className="icon-button task-search-submit"
            type="submit"
            aria-label="Search saved tasks"
          >
            <Search size={15} aria-hidden />
          </button>
        </form>
        <p className="result-count" role="status">
          {page
            ? `${page.total} ${query ? "matching" : "saved"} ${page.total === 1 ? "task" : "tasks"}`
            : "Saved work"}
        </p>
      </div>
      <div className="sidebar-list">
        <p className="sidebar-section-title">{query ? "Search results" : "Recent tasks"}</p>
        <nav aria-label="Saved tasks">
          <SidebarRecentRows
            rows={page?.tasks || []}
            selectedId={selectedId}
            onPick={(task) => { onSelect(task); onClose(); }}
            renderLabel={(task) => <>{task.name}{task.name_truncated ? "…" : ""}</>}
            renderMeta={(task) => task.history_ambiguous ? "History needs review" : null}
          />
        </nav>
        {error && (
          <div className="notice" role="alert">
            <p>{error}</p>
            <button
              className="text-button"
              onClick={() => void load(undefined, true)}
            >
              Refresh task list
            </button>
          </div>
        )}
        {loading && (
          <p className="supporting-text" role="status">
            Loading saved tasks…
          </p>
        )}
        {page?.total === 0 && !loading && (
          <p className="supporting-text">
            {query
              ? "No matching tasks. Try another name or topic."
              : "Your saved work will appear here."}
          </p>
        )}
        {page?.next_cursor && !error && (
          <button
            className="quiet-button"
            disabled={loading}
            onClick={() => void load(page.next_cursor!)}
          >
            Load more tasks
          </button>
        )}
      </div>
    </>
  );
  return mobile ? (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="workspace-backdrop" />
        <Dialog.Popup
          className="saved-sidebar mobile-sidebar"
          finalFocus={() => {
            if (focusComposerOnClose.current) {
              focusComposerOnClose.current = false;
              return composerRef.current;
            }
            return true;
          }}
          aria-label="Saved tasks"
        >
          <Dialog.Title className="sr-only">Saved tasks</Dialog.Title>
          {content}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  ) : (
    <aside className="saved-sidebar" aria-label="Saved tasks">
      {content}
    </aside>
  );
}
