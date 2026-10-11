import type { ChatBubble, RequestState } from "./types";
import { TaskRow } from "../ui/TaskRow";
export function ActiveWork({
  messages,
  requests,
  statusErrors,
  onViewRequest,
}: {
  messages: ReadonlyArray<ChatBubble>;
  requests: Record<string, RequestState>;
  statusErrors: Record<string, string>;
  onViewRequest: (index: number) => void;
}) {
  const active = Object.values(requests).filter(
    (request) =>
      !["succeeded", "failed", "interrupted"].includes(request.status),
  );
  return (
    <>
      {active.length > 0 && (
        <details className="active-work">
          <summary>
            <span className="status-dot" aria-hidden="true" />
            <strong>Active work</strong>
            <span>
              {active.length} {active.length === 1 ? "request" : "requests"}
            </span>
            <span className="active-disclosure" aria-hidden="true">
              ⌄
            </span>
          </summary>
          <div className="active-work-list" aria-label="Active task runs">
            {active.map((request) => {
              const index = messages.findIndex(
                (message) =>
                  message.role === "user" &&
                  message.requestId === request.request_id,
              );
              const runs = request.runs.length
                ? request.runs
                : [
                    {
                      id: request.request_id,
                      task_name: "Your request",
                      status: request.status,
                    },
                  ];
              return runs.map((run) => (
                <TaskRow
                  key={`${request.request_id}-${run.id}`}
                  className="active-work-row"
                  label={run.task_name}
                  status={run.status}
                  stale={Boolean(statusErrors[request.request_id])}
                  action={<button className="text-button" disabled={index < 0} onClick={() => onViewRequest(index)} aria-label={`View request for ${run.task_name}`}>View request ↗</button>}
                >
                  <p className="supporting-text">{request.origin === "chat" ? "Started from a message" : "Background request"} · Output stays with its request.</p>
                </TaskRow>
              ));
            })}
          </div>
        </details>
      )}
    </>
  );
}
