"use client";
// Adapted from Beautiful UI FilterTable and SearchList (MIT, Shane Levine, 2026).
// Counts and cells derive from loaded request receipts; no sample financial data.
import { useRef, useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { ArrowUpRight, Search, X } from "lucide-react";
import type { RequestState } from "../chat/types";
import { TASK_STATUS_LABELS } from "./TaskRow";
const isActive = (request: RequestState) => !["succeeded", "failed", "interrupted"].includes(request.status);
export function ActivityTable({ open, onClose, requests, onView }: { open: boolean; onClose: () => void; requests: Record<string, RequestState>; onView: (id: string) => void }) {
  const search = useRef<HTMLInputElement>(null);
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const all = Object.values(requests).sort((a,b) => b.created_at.localeCompare(a.created_at));
  const name = (request: RequestState) => request.runs.map(run => run.task_name).join(", ") || "New request";
  const matches = (request: RequestState, value: string) => value === "all" || (value === "active" ? isActive(request) : value === "complete" ? request.status === "succeeded" : ["failed", "interrupted"].includes(request.status));
  const rows = all.filter(request => matches(request, filter) && name(request).toLowerCase().includes(query.trim().toLowerCase()));
  return <Dialog.Root open={open} onOpenChange={value => { if (!value) onClose(); }}><Dialog.Portal><Dialog.Backdrop className="workspace-backdrop" /><Dialog.Popup className="activity-dialog" finalFocus aria-label="Recent activity">
    <header><div><Dialog.Title>Recent activity</Dialog.Title><Dialog.Description>Requests loaded in this session. Status comes from saved receipts.</Dialog.Description></div><Dialog.Close className="icon-button" aria-label="Close recent activity"><X size={18} aria-hidden /></Dialog.Close></header>
    <div className="activity-search"><Search size={16} aria-hidden /><input ref={search} maxLength={2048} aria-label="Search recent activity" placeholder="Find a request…" value={query} onChange={event => setQuery(event.target.value)} />{query && <button type="button" className="icon-button" aria-label="Clear activity search" onClick={() => { setQuery(""); search.current?.focus(); }}><X size={15} aria-hidden /></button>}</div>
    <div className="activity-filters" aria-label="Filter requests">{[["all","All"],["active","Active"],["complete","Complete"],["review","Needs review"]].map(([value,label]) => <button type="button" key={value} aria-pressed={filter===value} onClick={() => setFilter(value)}>{label}<span>{all.filter(request => matches(request,value)).length}</span></button>)}</div>
    <div className="activity-table-scroll"><table><thead><tr><th>Task</th><th>Status</th><th>Origin</th><th>Updated</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{rows.map(request => <tr key={request.request_id}><td>{name(request)}<span className="activity-task-meta">{request.origin === "chat" ? "Message" : request.origin} · <time dateTime={request.updated_at} title={new Date(request.updated_at).toLocaleString()}>{new Date(request.updated_at).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}</time></span></td><td><span className={`activity-pill state-${request.status}`}>{TASK_STATUS_LABELS[request.status]}</span></td><td>{request.origin === "chat" ? "Message" : request.origin}</td><td><time dateTime={request.updated_at} title={new Date(request.updated_at).toLocaleString()}>{new Date(request.updated_at).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}</time></td><td><button className="icon-button" aria-label={`View request for ${name(request)}`} onClick={() => onView(request.request_id)}><ArrowUpRight size={16} aria-hidden /></button></td></tr>)}</tbody></table>{!rows.length && <div className="activity-empty"><p role="status">{all.length ? "No requests match these filters." : "Your request activity will appear here."}</p>{all.length > 0 && (query.trim() || filter !== "all") && <button type="button" className="text-button" aria-label="Reset activity filters" onClick={() => { setQuery(""); setFilter("all"); search.current?.focus(); }}>Show all activity</button>}</div>}</div>
  </Dialog.Popup></Dialog.Portal></Dialog.Root>;
}
