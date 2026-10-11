import type { RequestState } from './types';
type StatusSnapshot = Pick<RequestState, 'request_id' | 'status' | 'updated_at'>;
const terminal = (status: string) => ['succeeded', 'failed', 'interrupted'].includes(status);
/** Compare server-owned snapshots; transport arrival order must not define run state. */
export function shouldAcceptStatus(previous: StatusSnapshot | undefined, candidate: StatusSnapshot): boolean {
  const incomingTime = Date.parse(candidate.updated_at);
  if (!Number.isFinite(incomingTime)) return false;
  if (!previous) return true;
  if (previous.request_id !== candidate.request_id || incomingTime < Date.parse(previous.updated_at)) return false;
  if (terminal(previous.status) && candidate.status !== previous.status) return false;
  return true;
}
