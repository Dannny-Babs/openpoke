"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Search, X } from "lucide-react";
import type { ChatBubble } from "./types";

// Kept outside either reading pane: opening/canceling never changes the reader.
export function MessageNavigator({ open, messages, onClose, onJump }: {
  open: boolean; messages: ReadonlyArray<ChatBubble>; onClose: () => void;
  onJump: (index: number) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  useEffect(() => {
    if (open && !dialog.current?.open) {
      dialog.current?.showModal();
      search.current?.focus();
    }
    if (!open && dialog.current?.open) dialog.current.close();
  }, [open]);
  const requests = messages.map((message, index) => ({ message, index }))
    .filter(({ message }) => message.role === "user");
  const matches = requests.filter(({ message }) => message.text.toLowerCase().includes(query.trim().toLowerCase()));
  return <dialog ref={dialog} className="history-navigator" aria-labelledby="history-navigator-title" onCancel={onClose} onClose={onClose}>
    <header><h2 id="history-navigator-title">Your messages</h2><button type="button" className="icon-button" onClick={onClose} aria-label="Close message history"><X size={17} aria-hidden /></button></header>
    <div className="history-search"><Search size={16} aria-hidden /><input ref={search} type="search" aria-label="Search your messages" placeholder="Find a request…" value={query} maxLength={2048} onChange={event => setQuery(event.target.value)} />{query && <button type="button" className="icon-button" aria-label="Clear message search" onClick={() => {setQuery(""); search.current?.focus();}}><X size={15} aria-hidden /></button>}</div>
    <nav aria-label="Jump to a message">
      {!matches.length && <p className="supporting-text">{requests.length ? "No messages match this search." : "Your requests will appear here."}</p>}
      {matches.map(({message,index}) => <button type="button" key={message.id} onClick={() => {onClose(); onJump(index);}}><span>{message.text}</span><ArrowUpRight size={15} aria-hidden /></button>)}
    </nav>
  </dialog>;
}
