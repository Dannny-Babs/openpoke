import { Mail } from "lucide-react";
import { MarkdownText } from "../chat/MarkdownText";

type EmailFields = { to: string; subject: string; body: string; from?: string; cc?: string; date?: string };

// Presentation adapter for the existing plain-text protocol, not mailbox metadata.
// Require a complete, leading header block; quoted headers and prose stay prose.
export function parseEmail(text: string): EmailFields | null {
  const normalized = text.replace(/\r\n/g, "\n").trimStart();
  const boundary = normalized.indexOf("\n\n");
  if (boundary < 0) return null;
  const lines = normalized.slice(0, boundary).split("\n");
  if (lines.length < 2 || lines.length > 5) return null;
  const fields: Record<string, string> = {};
  for (const line of lines) {
    const match = line.match(/^(?:\*\*)?(To|From|Cc|Subject|Date):(?:\*\*)?\s*(.+)$/i);
    if (!match) return null;
    const key = match[1].toLowerCase();
    if (fields[key]) return null;
    fields[key] = match[2].trim();
    if (!fields[key]) return null;
  }
  const body = normalized.slice(boundary + 2);
  return fields.to && fields.subject && body.trim()
    ? { to: fields.to, subject: fields.subject, body, from: fields.from, cc: fields.cc, date: fields.date }
    : null;
}

export function EmailReply({ text, email, draft = false, provisional = false }: {
  text: string; email: EmailFields | null; draft?: boolean; provisional?: boolean;
}) {
  return <section className="email-reply" aria-label={draft ? "Email draft" : "Email content"}>
    <header className="email-heading">
      <span className="email-mark" aria-hidden><Mail size={18} strokeWidth={1.5} /></span>
      <div className="email-heading-copy">
      <h2>{email?.subject || "Email draft"}</h2>

    {email ? <dl className="email-fields">
      {email.from ? <><dt>From</dt><dd>{email.from}</dd></> : null}
      <dt>To</dt><dd>{email.to}</dd>
      {email.cc ? <><dt>Cc</dt><dd>{email.cc}</dd></> : null}
      {email.date ? <><dt>Date</dt><dd>{email.date}</dd></> : null}
    </dl> : null}
      </div>
      <span className="email-state">{provisional ? "In progress" : draft ? "Not sent" : "Delivery not tracked"}</span>
    </header>
    <div className="email-body" data-selectable-answer><MarkdownText text={email?.body || text} /></div>
  </section>;
}
