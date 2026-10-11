"use client";
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { SavedTask } from "./TaskDrawer";
import { StreamingReply } from "../ui/StreamingReply";

type Entry = { kind: string; timestamp: string; content: string; truncated: boolean };
type History = { entries: Entry[]; start_offset: number; before_offset: number | null; next_offset: number | null };
type Row = Entry & { offset: number };

export function TaskHistory({ task, refreshKey, onAsk }: {
  task: SavedTask; refreshKey: number; onAsk?: (text: string) => void;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [away, setAway] = useState(false);
  const record = useRef<Row[]>([]);
  const controller = useRef<AbortController | null>(null);
  const container = useRef<HTMLDivElement | null>(null);
  const following = useRef(true);
  const restore = useRef<{ offset: number; top: number } | null>(null);
  const retry = useRef<number | undefined>(undefined);

  const bottom = useCallback(() => {
    if (container.current) container.current.scrollTop = container.current.scrollHeight;
    following.current = true;
    setAway(false);
  }, []);
  const handleScroll = () => {
    const node = container.current;
    if (!node) return;
    following.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
    setAway(!following.current);
  };
  const load = useCallback(async (before?: number) => {
    controller.current?.abort();
    const pending = new AbortController();
    controller.current = pending;
    retry.current = before;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/tasks/${task.id}/history?${before === undefined ? "latest=true" : `before=${before}`}&limit=20`, {
        cache: "no-store", signal: pending.signal,
      });
      const data: History & { error?: string; detail?: string } = await response.json();
      if (!response.ok) throw Error(data.error || data.detail || "Could not load task history.");
      if (!Array.isArray(data.entries) || !Number.isInteger(data.start_offset) || data.start_offset < 0 || data.entries.length > 20)
        throw Error("Task history unavailable.");
      if (pending.signal.aborted) return;
      // Capture the visible record immediately before committing, after any scrolling during fetch.
      const node = container.current;
      if (node && (before !== undefined || !following.current)) {
        const edge = node.getBoundingClientRect().top;
        const visible = Array.from(node.querySelectorAll<HTMLElement>("[data-history-offset]")).find(row => row.getBoundingClientRect().bottom > edge);
        restore.current = visible ? { offset: Number(visible.dataset.historyOffset), top: visible.getBoundingClientRect().top - edge } : null;
      }
      const merged = new Map(record.current.map(row => [row.offset, row]));
      data.entries.forEach((entry, index) => merged.set(data.start_offset + index, { ...entry, offset: data.start_offset + index }));
      const next = Array.from(merged.values()).sort((a, b) => a.offset - b.offset);
      record.current = next;
      setRows(next);
    } catch (cause) {
      if (!pending.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not load history.");
    } finally {
      if (!pending.signal.aborted) setLoading(false);
    }
  }, [task.id]);

  useLayoutEffect(() => {
    const node = container.current;
    const saved = restore.current;
    restore.current = null;
    if (node && saved) {
      const anchor = node.querySelector<HTMLElement>(`[data-history-offset="${saved.offset}"]`);
      if (anchor) node.scrollTop += anchor.getBoundingClientRect().top - node.getBoundingClientRect().top - saved.top;
      handleScroll();
    } else if (following.current) bottom();
  }, [rows, bottom]);

  useEffect(() => {
    record.current = [];
    setRows([]);
    setError(null);
    following.current = true;
    restore.current = null;
    if (!task.history_ambiguous) void load();
    return () => controller.current?.abort();
  }, [task.id, task.history_ambiguous, load]);
  const previous = useRef(refreshKey);
  useEffect(() => {
    if (previous.current !== refreshKey) {
      previous.current = refreshKey;
      if (!task.history_ambiguous) void load();
    }
  }, [refreshKey, load, task.history_ambiguous]);

  const earlier = (before: number, label = "Load earlier") => <button type="button" className="quiet-button" disabled={loading} onClick={() => void load(before)}>{label}</button>;
  return <div className="thread-region">
    <div ref={container} onScroll={handleScroll} className="message-scroll" aria-label={`History for ${task.name}`}>
      <div className="message-content">
        {task.history_ambiguous ? <p className="notice" role="alert">This task shares a legacy history file. It needs to be separated before history can be shown or continued safely.</p> : <>
          {rows.length > 0 && rows[0].offset > 0 && earlier(rows[0].offset)}
          {rows.map((entry, index) => {
            const dialogue = entry.kind === "agent_request" || entry.kind === "agent_response";
            return <Fragment key={entry.offset}>
              {index > 0 && rows[index - 1].offset + 1 < entry.offset && earlier(entry.offset, "Load missing activity")}
              <article data-history-offset={entry.offset} data-task-id={task.id} data-task-name={task.name} className={`message-turn ${entry.kind === "agent_request" ? "user-turn" : "assistant-turn"} history-entry`}>
                {dialogue ? <>
                  <p className="assistant-label"><CompactTime timestamp={entry.timestamp} /></p>
                  {entry.kind === "agent_request" ? <div className="user-message">{entry.content}</div> : <StreamingReply text={entry.content}>
                    {onAsk && <button type="button" className="text-button" onClick={() => onAsk(entry.content.slice(0, 2000))}>Ask about reply</button>}
                  </StreamingReply>}
                </> : <details><summary>{entry.kind === "agent_action" ? "Tool action" : entry.kind === "tool_response" ? "Tool result" : "Saved activity"} <CompactTime timestamp={entry.timestamp} /></summary><p>{entry.content}</p></details>}
                {entry.truncated && <small>Shortened for display. The complete record remains saved.</small>}
              </article>
            </Fragment>;
          })}
          {!rows.length && !loading && !error && <p className="supporting-text">No saved activity yet.</p>}
          {loading && <p className="loading-note" role="status">Loading history…</p>}
          {error && <div className="notice" role="alert"><p>{error}</p><button type="button" className="text-button" onClick={() => void load(retry.current)}>Retry history</button></div>}
        </>}
      </div>
    </div>
    {away && <button type="button" className="latest-button quiet-button" onClick={bottom}>Latest ↓</button>}
  </div>;
}

function CompactTime({ timestamp }: { timestamp: string }) {
  // Legacy records contain wall time without an offset; don't invent an instant.
  const explicitZone = /(?:Z|[+-]\d{2}:\d{2})$/i.test(timestamp);
  const legacy = /^\d{4}-\d{2}-\d{2} ([0-2]\d:[0-5]\d):[0-5]\d$/.exec(timestamp);
  if (legacy) return <time dateTime={timestamp.replace(" ", "T")} title={`${timestamp} · recorded time; timezone not saved`} aria-label={`${timestamp}, recorded time; timezone not saved`}>{legacy[1]}</time>;
  const date = new Date(timestamp);
  const valid = explicitZone && !Number.isNaN(date.getTime());
  return <time dateTime={valid ? date.toISOString() : undefined} title={valid ? date.toISOString() : timestamp} aria-label={valid ? date.toLocaleString() : timestamp}>
    {valid ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "Saved"}
  </time>;
}
