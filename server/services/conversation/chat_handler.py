from fastapi.responses import JSONResponse
from ...models import ChatRequest
from ...agents.interaction_agent.runtime import InteractionAgentRuntime
from ..execution.request_coordinator import get_request_coordinator
from ..execution.request_store import SubmissionConflict
from ...utils import error_response

def _extract_latest_user_message(payload):
    return next((m for m in reversed(payload.messages) if m.role.lower().strip() == "user" and m.content.strip()), None)

async def handle_chat_request(payload: ChatRequest):
    message = _extract_latest_user_message(payload)
    if message is None:
        return error_response("Missing user message", status_code=400)
    try:
        # Validate model configuration before acknowledging new work.
        InteractionAgentRuntime()
        body = get_request_coordinator().submit(message.content.strip(), payload.task_id,
                    str(payload.submission_id) if payload.submission_id else None)
    except SubmissionConflict as exc:
        return error_response(str(exc), status_code=409)
    except KeyError:
        return error_response("Task no longer exists; no replacement was created", status_code=404)
    except ValueError as exc:
        return error_response(str(exc), status_code=400)
    except RuntimeError as exc:
        return error_response(str(exc), status_code=503)
    return JSONResponse({key: body[key] for key in ("request_id", "status", "task_id")}, status_code=202)
