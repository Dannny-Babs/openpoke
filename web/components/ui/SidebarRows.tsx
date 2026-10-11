// Adapted from Beautiful UI SidebarNav.tsx (RailButton and recent rows).
// Copyright (c) 2026 Shane Levine, MIT. See /THIRD_PARTY_NOTICES.md.
import type { ReactNode } from "react";
import { Plus, MessageCircle, Search } from "lucide-react";

export function SidebarRailButton({ icon, label, active = false, onClick, className = "" }: {
  icon: ReactNode; label: string; active?: boolean; onClick: () => void; className?: string;
}) {
  return (
    <button data-row type="button" onClick={onClick} aria-current={active ? "page" : undefined} className={`sidebar-rail-row ${active ? "selected" : ""} ${className}`}>
      <span className="sidebar-row-icon" aria-hidden="true">{icon}</span>
      <span className="sidebar-row-copy">{label}</span>
    </button>
  );
}

export function SidebarRecentRows<T extends { id: string; name: string }>({ rows, selectedId, onPick, renderMeta, renderLabel }: {
  rows: T[]; selectedId?: string; onPick: (row: T) => void;
  renderMeta: (row: T) => ReactNode; renderLabel: (row: T) => ReactNode;
}) {
  return (
    <ul className="task-list">
      {rows.map(item => (
        <li key={item.id}>
          <button data-row data-task-id={item.id} type="button" title={item.name} onClick={() => onPick(item)} aria-current={selectedId === item.id ? "page" : undefined} className={`sidebar-recent-row ${selectedId === item.id ? "selected" : ""}`}>
            <span className="task-label">{renderLabel(item)}</span>
            {renderMeta(item) && <span className="task-meta">{renderMeta(item)}</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}

export function SidebarIcon({ kind }: { kind: "new" | "messages" | "search" }) {
  const Icon = kind === "new" ? Plus : kind === "search" ? Search : MessageCircle;
  return <Icon size={18} strokeWidth={1.6} aria-hidden />;
}
