import { Fragment, ReactNode } from 'react';
// Deliberately bounded Markdown subset. React escapes text; HTML is never evaluated.
function inline(text: string): ReactNode[] {
  const pattern = /(\[[^\]\n]+\]\(https?:\/\/[^\s)]+\)|`[^`\n]+`|\*\*[^*\n]+\*\*)/g;
  return text.split(pattern).map((part,index) => {
    const link = part.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
    if (link) { try { const url = new URL(link[2]); if (['https:','http:'].includes(url.protocol)) return <a key={index} className="source-link" href={url.href} title={url.href} aria-label={`${link[1]} — ${url.hostname} (opens in a new tab)`} target="_blank" rel="noopener noreferrer"><span>{link[1]}</span><span aria-hidden="true">↗</span></a>; } catch {} }
    if (part.startsWith('`') && part.endsWith('`')) return <code key={index}>{part.slice(1,-1)}</code>;
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={index}>{part.slice(2,-2)}</strong>;
    return <Fragment key={index}>{part}</Fragment>;
  });
}
export function MarkdownText({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g,'\n').split('\n');
  const blocks: ReactNode[] = [];
  for (let index = 0; index < lines.length;) {
    const line = lines[index]; const key = index;
    if (!line.trim()) { index++; continue; }
    if (line.startsWith('```')) { const language = line.slice(3).trim(); const code: string[] = []; index++; while(index < lines.length && !lines[index].startsWith('```')) code.push(lines[index++]); if(index < lines.length) index++; blocks.push(<div className="code-block" key={key}>{language && <small>{language}</small>}<pre><code>{code.join('\n')}</code></pre></div>); continue; }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) { blocks.push(heading[1].length === 1 ? <h2 key={key}>{inline(heading[2])}</h2> : <h3 key={key}>{inline(heading[2])}</h3>); index++; continue; }
    if (/^\s*([-*•]|\d+\.)\s+/.test(line)) { const ordered = /^\s*\d+\./.test(line); const items: ReactNode[] = []; while(index < lines.length && (ordered ? /^\s*\d+\.\s+/ : /^\s*[-*•]\s+/).test(lines[index])) { items.push(<li key={index}>{inline(lines[index].replace(/^\s*([-*•]|\d+\.)\s+/,''))}</li>); index++; } blocks.push(ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>); continue; }
    const paragraph: string[] = [line]; index++;
    while(index < lines.length && lines[index].trim() && !/^(#{1,3}\s|```|\s*([-*•]|\d+\.)\s+)/.test(lines[index])) paragraph.push(lines[index++]);
    blocks.push(<p key={key}>{inline(paragraph.join('\n'))}</p>);
  }
  return <div className="reply-prose">{blocks}</div>;
}
