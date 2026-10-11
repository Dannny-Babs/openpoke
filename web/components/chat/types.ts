export interface ChatBubble { id: string; role: string; text: string; requestId?: string; taskId?: string; deliveryUnconfirmed?: boolean; }
export type TaskTarget = { id: string; name: string };
export type RunStatus = 'queued' | 'routing' | 'running' | 'responding' | 'succeeded' | 'failed' | 'interrupted';
export type RequestState = { request_id: string; status: RunStatus; task_id: string | null; origin: string; error: string | null; created_at: string; updated_at: string; partial_response?: string | null; runs: Array<{id: string; task_id: string; task_name: string; status: RunStatus; error: string | null; response: string | null; partial_response?: string | null; activity?: {name: string; status: 'running' | 'succeeded' | 'failed'} | null}> };
