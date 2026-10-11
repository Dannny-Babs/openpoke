import { History, PanelLeft, Settings2, ListFilter } from "lucide-react";
interface ChatHeaderProps { onOpenSettings: () => void; onOpenActivity: () => void; onOpenTasks: () => void; tasksOpen: boolean; onOpenHistory: () => void; }
export function ChatHeader({ onOpenSettings, onOpenActivity, onOpenTasks, tasksOpen, onOpenHistory }: ChatHeaderProps) {
  return <header className="chat-header"><div><h1>OpenPoke<span className="brand-dot" aria-hidden="true">.</span></h1></div><nav aria-label="Conversation controls">
    <button aria-label="Saved tasks" className="quiet-button mobile-tasks-button" onClick={onOpenTasks} aria-haspopup="dialog" aria-expanded={tasksOpen}><PanelLeft size={16} aria-hidden /><span>Saved tasks</span></button>
    <button aria-label="Your messages" className="text-button history-trigger" onClick={onOpenHistory} aria-haspopup="dialog"><History size={16} aria-hidden /><span>Your messages</span></button>
    <button aria-label="Activity" className="text-button activity-trigger" onClick={onOpenActivity} aria-haspopup="dialog"><ListFilter size={16} aria-hidden /><span>Activity</span></button>
    <button aria-label="Settings" className="text-button" onClick={onOpenSettings}><Settings2 size={16} aria-hidden /><span>Settings</span></button>
  </nav></header>;
}
