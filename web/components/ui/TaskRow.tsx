"use client";
// Adapted from Beautiful UI TaskRows.tsx, Copyright (c) 2026 Shane Levine.
// MIT license and source provenance: /THIRD_PARTY_NOTICES.md.
// Demo clocks, progress percentages and automatic retries are intentionally removed.
import { useId, useState, type ReactNode } from "react";
import { Check, X, Pause, Clock } from "lucide-react";
import type { RunStatus } from "../chat/types";

export const TASK_STATUS_LABELS: Record<RunStatus, string> = {
  queued: "Queued", routing: "Finding the right task", running: "Working",
  responding: "Preparing a response", succeeded: "Complete", failed: "Failed",
  interrupted: "Interrupted",
};

function StatusMark({ status, stale }: { status: RunStatus; stale: boolean }) {
  const active = !stale && ["running", "routing", "responding"].includes(status);
  const Icon = status === "succeeded" ? Check : status === "failed" ? X : status === "queued" ? Clock : Pause;
  return <span aria-hidden="true" className={`task-status-mark state-${stale ? "stale" : status}`}>
    {active ? <svg className="task-ring spinning" width="20" height="20" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" opacity=".2" strokeWidth="2" /><path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg> : <Icon size={14} strokeWidth={2} />}
  </span>;
}

export function TaskRow({ label, status, statusLabel, stale = false, children, action, initiallyExpanded = false, expandable = true, className = "" }: {
  label: string; status: RunStatus; statusLabel?: string; stale?: boolean; children?: ReactNode;
  action?: ReactNode; initiallyExpanded?: boolean; expandable?: boolean; className?: string;
}) {
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const detailId = useId();
  const heading = <>
    <StatusMark status={status} stale={stale} />
    <span className="task-run-copy"><span className="task-run-label">{label}</span><span className="task-run-status">{stale ? `Status unavailable · Last known: ${TASK_STATUS_LABELS[status]}` : statusLabel || TASK_STATUS_LABELS[status]}</span></span>
    {expandable && <svg aria-hidden="true" className="task-run-chevron" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{transform: expanded ? "rotate(180deg)" : undefined}}><path d="M6 9l6 6 6-6" /></svg>}
  </>;
  return (
    <div className={`task-run-row ${className}`} data-status={stale ? "stale" : status}>
      <div className="task-run-heading">
        {expandable ? <button type="button" className="task-run-toggle" aria-expanded={expanded} aria-controls={detailId} onClick={() => setExpanded(value => !value)}>{heading}</button> : <div className="task-run-toggle">{heading}</div>}
        {action}
      </div>
      {expandable && <div id={detailId} hidden={!expanded} className="task-run-details">{children}</div>}
    </div>
  );
}
