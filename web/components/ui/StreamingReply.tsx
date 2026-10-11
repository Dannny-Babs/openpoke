// Adapted from Beautiful UI StreamingText and ChatComposer (MIT, Shane Levine, 2026).
// Actual reply-so-far replaces timed word reveal; source/certainty demos omitted.
import type { ReactNode } from "react";
import { LoaderCircle } from "lucide-react";
import { MarkdownText } from "../chat/MarkdownText";
import { EmailReply, parseEmail } from "./EmailReply";
export function StreamingReply({ text, provisional = false, stale = false, emailDraft = false, children }: { text: string; provisional?: boolean; stale?: boolean; emailDraft?: boolean; children?: ReactNode }) {
  const email = parseEmail(text);
  return <div className={`beautiful-reply ${provisional ? "provisional" : ""}`}>
    {provisional && <p className="reply-state">{!stale && <LoaderCircle size={13} className="spinning" aria-hidden />}{stale ? "Last received · Status unavailable" : "Reply in progress"}</p>}
    {email || emailDraft ? <EmailReply text={text} email={email} draft={emailDraft} provisional={provisional} /> : <div className="reply-body" data-selectable-answer><MarkdownText text={text} /></div>}
    {children && <div className="reply-actions">{children}</div>}
  </div>;
}
