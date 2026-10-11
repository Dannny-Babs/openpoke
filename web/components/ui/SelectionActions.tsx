"use client";
// Adapted from Beautiful UI SelectionActions (MIT, Shane Levine, 2026).
// Real answer selection + callbacks replace simulated thinking/rewrites.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Copy, MessageCircle, X } from "lucide-react";
import { toast } from "sonner";
import type { PromptExcerpt } from "./PromptReviewCard";
export function SelectionActions({ children, onAsk }: { children: ReactNode; onAsk: (excerpt: PromptExcerpt) => void }) {
  const root = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<(PromptExcerpt & { top: number; left: number }) | null>(null);
  useEffect(() => {
    function inspect(event?: Event) {
      if (event instanceof KeyboardEvent && event.key === "Escape") { setSelection(null); return; }
      if ((event?.target as Element)?.closest?.("[data-selection-toolbar]")) return;
      const selected = window.getSelection();
      if (!selected || selected.isCollapsed || !selected.rangeCount || !root.current) { setSelection(null); return; }
      const range = selected.getRangeAt(0);
      const anchor = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer as Element : range.startContainer.parentElement;
      const end = range.endContainer.nodeType === Node.ELEMENT_NODE ? range.endContainer as Element : range.endContainer.parentElement;
      const answer = anchor?.closest("[data-selectable-answer]");
      if (!answer || !root.current.contains(answer) || end?.closest("[data-selectable-answer]") !== answer) { setSelection(null); return; }
      const text = selected.toString().trim();
      if (!text) { setSelection(null); return; }
      const rect = range.getBoundingClientRect();
      const row = answer.closest<HTMLElement>("[data-task-id]");
      setSelection({ text: text.slice(0, 2000), taskId: row?.dataset.taskId || undefined, taskName: row?.dataset.taskName || undefined, top: Math.min(innerHeight - 60, rect.bottom + 8), left: Math.max(8, Math.min(innerWidth - 266, rect.left)) });
    }
    const hide = () => setSelection(null);
    document.addEventListener("pointerup", inspect); document.addEventListener("keyup", inspect);
    document.addEventListener("scroll", hide, true);
    return () => { document.removeEventListener("pointerup", inspect); document.removeEventListener("keyup", inspect); document.removeEventListener("scroll", hide, true); };
  }, []);
  return <div ref={root} className="selection-scope">{children}{selection && <div data-selection-toolbar className="selection-toolbar" role="toolbar" aria-label="Selected text actions" style={{ top: selection.top, left: selection.left }} onPointerDown={event => event.preventDefault()}>
    <button type="button" onClick={() => { void navigator.clipboard.writeText(selection.text).then(() => toast.success("Copied selection")).catch(() => toast.error("Could not copy. Select the text to copy it.")); }}><Copy size={14} aria-hidden />Copy</button>
    <button type="button" onClick={() => { onAsk(selection); setSelection(null); }}><MessageCircle size={14} aria-hidden />Ask about this</button>
    <button type="button" className="icon-button" aria-label="Close selection actions" onClick={() => setSelection(null)}><X size={14} aria-hidden /></button>
  </div>}</div>;
}
