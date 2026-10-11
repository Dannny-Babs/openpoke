"use client";
// Adapted from Beautiful UI PromptBar.tsx (MIT, Shane Levine, 2026).
// Composer/chip/menu composition; controlled app state replaces gallery demos.
import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { ArrowUp, AtSign, Plus, Search, Settings2, Slash, X } from "lucide-react";
import type { TaskTarget } from "../chat/types";
const COMMANDS = [
  { key: "draft", name: "/draft", desc: "Write a draft for review", text: "Draft an email about … Keep it as a draft; do not send it." },
  { key: "compare", name: "/compare", desc: "Weigh the options", text: "Compare … Explain the tradeoffs and what still needs checking." },
  { key: "summarize", name: "/summarize", desc: "Catch up on this task", text: "Summarize what we have done, what remains, and any unresolved questions." },
];
type Task = TaskTarget & { history_ambiguous?: boolean; name_truncated?: boolean };
export function PromptBar({ value, canSubmit, placeholder, onChange, onSubmit, target, onClearTarget, inputRef, onPickTask, onOpenTasks, onOpenSettings, mode }: {
  value: string; canSubmit: boolean; placeholder: string; onChange: (text: string) => void;
  onSubmit: () => void | Promise<void>; target: TaskTarget | null; onClearTarget: () => void;
  inputRef: RefObject<HTMLTextAreaElement | null>; onPickTask: (task: TaskTarget) => void | Promise<void>;
  onOpenTasks: () => void; onOpenSettings: () => void; mode: string;
}) {
  const [plusOpen, setPlusOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [active, setActive] = useState(0);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const wrapper = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const token = /(^|\s)([@/])([^@/\n]*)$/.exec(value);
  const menu = dismissed ? null : plusOpen ? "slash" : token?.[2] === "@" ? "at" : token?.[2] === "/" ? "slash" : null;
  const query = plusOpen ? "" : token?.[3]?.trim() || "";
  const searching = menu === "at" && loading;
  const searchError = menu === "at" ? error : "";
  const queryStart = token ? token.index + token[1].length : value.length;
  const commands = COMMANDS.filter(row => row.name.slice(1).includes(query.toLowerCase()));
  const rows = menu === "at" ? tasks.map(task => ({ key: task.id, name: task.name, desc: task.history_ambiguous ? "History needs review" : "Continue saved task", disabled: task.history_ambiguous, task })) : commands.map(row => ({ ...row, task: undefined, disabled: false }));
  useEffect(() => { setActive(0); }, [menu, query]);
  useEffect(() => {
    if (menu !== "at") return;
    const controller = new AbortController();
    setTasks([]); setLoading(true); setError("");
    const timer = setTimeout(() => {
      void fetch(`/api/tasks?q=${encodeURIComponent(query)}`, { cache: "no-store", signal: controller.signal })
        .then(async response => { const data = await response.json(); if (!response.ok || !Array.isArray(data.tasks)) throw Error("Could not find saved tasks."); if (!controller.signal.aborted) setTasks(data.tasks); })
        .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Search unavailable."); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 180);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [menu, query]);
  useEffect(() => {
    if (!menu) return;
    const close = (event: PointerEvent) => { if (!wrapper.current?.contains(event.target as Node)) { setPlusOpen(false); setDismissed(true); } };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [menu]);
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = "0px";
    input.style.height = `${Math.min(120, Math.max(44, input.scrollHeight))}px`;
    input.style.overflowY = input.scrollHeight > 120 ? "auto" : "hidden";
  }, [value, inputRef]);
  function pick(index: number) {
    const row = rows[index];
    if (!row || row.disabled) return;
    if (row.task) { onChange(value.slice(0, queryStart).trimEnd()); void onPickTask(row.task); }
    else { const command = COMMANDS.find(command => command.key === row.key); if (command) { const prefix = plusOpen ? value : value.slice(0, queryStart); onChange(prefix + (plusOpen && prefix.trim() ? "\n\n" : "") + command.text); } }
    setPlusOpen(false); setDismissed(true); inputRef.current?.focus();
  }
  return <div ref={wrapper} data-promptbar className="promptbar-wrap">
    {menu && <div className="prompt-menu" id={menuId} role="listbox" aria-label={menu === "at" ? "Choose saved task" : "Prompt shortcuts"}>
      <div className="prompt-menu-title">{menu === "at" ? "Saved tasks" : "Start with a prompt"}</div>
      {rows.map((row, index) => <button id={`${menuId}-${index}`} key={row.key} type="button" role="option" aria-selected={active === index} disabled={row.disabled} className={active === index ? "active" : ""} onMouseEnter={() => setActive(index)} onMouseDown={event => event.preventDefault()} onClick={() => pick(index)}>
        {menu === "at" ? <AtSign size={16} aria-hidden /> : <Slash size={16} aria-hidden />}<span><strong>{row.name}</strong><small>{row.desc}</small></span>
      </button>)}
      {searching && <p role="status">Searching saved tasks…</p>}
      {searchError && <p role="alert">{searchError}</p>}
      {!searching && !searchError && !rows.length && <p>No matches. Try another name.</p>}
      <div className="prompt-menu-hint">↑ ↓ to choose · Enter to insert · Esc to close</div>
    </div>}
    <form onSubmit={event => { event.preventDefault(); if (canSubmit && !menu) void onSubmit(); }} className="composer-field beautiful-promptbar">
      {target && <div className="task-target"><AtSign size={13} aria-hidden /><span>Continuing · {target.name}</span><button type="button" onClick={onClearTarget} aria-label="Remove selected task"><X size={14} aria-hidden /></button></div>}
      <label className="sr-only" htmlFor="message">Your next request</label>
      <textarea ref={inputRef} id="message" value={value} placeholder={placeholder} rows={1} role="combobox" aria-autocomplete="list" aria-expanded={Boolean(menu)} aria-controls={menu ? menuId : undefined} aria-activedescendant={menu && rows[active] ? `${menuId}-${active}` : undefined}
        onChange={event => { onChange(event.target.value); setDismissed(false); setPlusOpen(false); }}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing) return;
          if (menu && rows.length && (event.key === "ArrowDown" || event.key === "ArrowUp")) { event.preventDefault(); setActive(current => (current + (event.key === "ArrowDown" ? 1 : rows.length - 1)) % rows.length); return; }
          if (menu && event.key === "Enter" && !event.shiftKey) { event.preventDefault(); if (!searching && !searchError && rows.length) pick(active); return; }
          if (event.key === "Escape") { setPlusOpen(false); setDismissed(true); return; }
          if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); if (canSubmit) void onSubmit(); }
        }} />
      <div className="promptbar-controls">
        <button type="button" className="icon-button" aria-label="Prompt shortcuts" aria-expanded={plusOpen} onClick={() => { setPlusOpen(current => !current); setDismissed(false); inputRef.current?.focus(); }}><Plus size={18} aria-hidden /></button>
        <button type="button" className="prompt-context-control" aria-label="Find saved tasks" onClick={onOpenTasks}><Search size={15} aria-hidden /><span>Saved tasks</span></button>
        <span className="promptbar-spacer" />
        <button type="button" className="prompt-mode" onClick={onOpenSettings} title="App mode and settings"><Settings2 size={14} aria-hidden /><span>{mode}</span></button>
        <button type="submit" className="prompt-send" disabled={!canSubmit || Boolean(menu)} aria-label="Send"><ArrowUp size={19} strokeWidth={2} aria-hidden /></button>
      </div>
    </form>
    <p className="promptbar-hint"><span>@ saved task · / shortcuts</span><span>Enter to send · Shift + Enter for a new line</span></p>
  </div>;
}
