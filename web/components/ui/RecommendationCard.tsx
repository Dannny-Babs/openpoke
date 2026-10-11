"use client";
// Adapted from Beautiful UI RecommendationCard (MIT, Shane Levine, 2026).
// Real prompt callback replaces demo acceptance; confidence meter omitted.
import { useState } from "react";
import { ArrowUpRight, ChevronDown, Mail, Scale, ListChecks } from "lucide-react";
const OPTIONS = [
  { title: "Get a draft ready", body: "Find the words, review the result, then refine it together.", prompt: "Draft a friendly email about … Keep it as a draft; do not send it.", icon: Mail },
  { title: "Make a decision", body: "Compare the options and separate facts from what still needs checking.", prompt: "Help me compare … Explain the tradeoffs and what we need to verify.", icon: Scale },
  { title: "Break down a task", body: "Turn a goal into a manageable next step.", prompt: "Help me plan … Break it into concrete steps and suggest where to start.", icon: ListChecks },
];
export function RecommendationCard({ onChoose }: { onChoose: (text: string) => void }) {
  const [selected, setSelected] = useState(0);
  const [open, setOpen] = useState(false);
  const option = OPTIONS[selected]; const Icon = option.icon;
  return <section className="recommendation-card" aria-label="Suggested starting points">
    <div className="recommendation-main"><span className="recommendation-icon"><Icon size={21} strokeWidth={1.5} aria-hidden /></span><div><h3>{option.title}</h3><p>{option.body}</p></div></div>
    {open && <div className="recommendation-options">{OPTIONS.map((item, index) => <button type="button" key={item.title} onClick={() => { setSelected(index); setOpen(false); }} aria-pressed={selected === index}>{item.title}</button>)}</div>}
    <footer><button type="button" className="text-button" onClick={() => setOpen(value => !value)} aria-expanded={open}>Other ideas <ChevronDown size={14} aria-hidden /></button><button type="button" className="quiet-button" onClick={() => onChoose(option.prompt)}>Use prompt <ArrowUpRight size={15} aria-hidden /></button></footer>
  </section>;
}
