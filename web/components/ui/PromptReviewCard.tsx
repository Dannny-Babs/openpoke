"use client";
// Adapted from Beautiful UI ApprovalCard (MIT, Shane Levine, 2026).
// A local prompt-context choice, not approval to execute an external action.
import { useId, useState } from "react";
import { ArrowUpRight, Check, X } from "lucide-react";
export type PromptExcerpt = { text: string; taskId?: string; taskName?: string };
export function PromptReviewCard({ excerpt, onAdd, onDismiss }: { excerpt: PromptExcerpt; onAdd: (instruction: string) => void; onDismiss: () => void }) {
  const id = useId();
  const [choice, setChoice] = useState("Explain this passage");
  const [custom, setCustom] = useState("");
  return <section className="prompt-review-card" aria-labelledby={id}>
    <header><h3 id={id}>What would you like to do with this?</h3><button type="button" className="icon-button" aria-label="Dismiss selected excerpt" onClick={onDismiss}><X size={16} aria-hidden /></button></header>
    <blockquote>{excerpt.text}</blockquote>
    <fieldset><legend className="sr-only">Follow-up instruction</legend>{["Explain this passage", "Make it shorter", "Rewrite it in a warmer tone"].map(option => <label key={option} className={choice === option ? "selected" : ""}><input type="radio" name={id} checked={choice === option} onChange={() => { setChoice(option); setCustom(""); }} /><span>{option}</span>{choice === option && <Check size={13} aria-hidden />}</label>)}</fieldset>
    <input maxLength={2048} className="excerpt-custom" aria-label="Custom instruction for selection" placeholder="Or ask something else…" value={custom} onChange={event => setCustom(event.target.value)} />
    <footer><span>Adds to your prompt. You review before sending.</span><button type="button" className="btn" onClick={() => onAdd(custom.trim() || choice)}>Add to prompt <ArrowUpRight size={15} aria-hidden /></button></footer>
  </section>;
}
