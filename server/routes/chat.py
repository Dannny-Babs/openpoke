from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse

from ..models import ChatHistoryClearResponse, ChatHistoryResponse, ChatRequest
from ..services import get_conversation_log, get_trigger_service, handle_chat_request

router = APIRouter(prefix="/chat", tags=["chat"])


@router.post("/send", response_class=JSONResponse, summary="Submit a chat message and receive a completion")
# Handle incoming chat messages and route them to the interaction agent
async def chat_send(
    payload: ChatRequest,
) -> JSONResponse:
    return await handle_chat_request(payload)


@router.get("/requests/{request_id}")
def request_status(request_id: str):
    from ..services.execution.request_coordinator import get_request_coordinator
    body = get_request_coordinator().store.get(request_id)
    if body is None:
        raise HTTPException(status_code=404, detail="Request not found")
    return body


@router.get("/history", response_model=ChatHistoryResponse)
# Retrieve the conversation history from the log
def chat_history() -> ChatHistoryResponse:
    log = get_conversation_log()
    return ChatHistoryResponse(messages=log.to_chat_messages())


@router.delete("/history", response_model=ChatHistoryClearResponse)
async def clear_history() -> ChatHistoryClearResponse:
    from ..services import get_execution_agent_logs, get_agent_roster

    from ..services.execution.request_coordinator import get_request_coordinator
    from ..services.trigger_scheduler import get_trigger_scheduler
    coordinator = get_request_coordinator()
    scheduler = get_trigger_scheduler()
    # No awaits between guard and deletion: atomic against dispatch in one event loop.
    if coordinator.has_active_work() or scheduler._in_flight:
        raise HTTPException(status_code=409, detail="Wait for active work to finish before clearing history")
    coordinator.store.clear()

    # Clear conversation log
    log = get_conversation_log()
    log.clear()

    # Clear execution agent logs
    execution_logs = get_execution_agent_logs()
    execution_logs.clear_all()

    # Clear agent roster
    roster = get_agent_roster()
    roster.clear()

    # Clear stored triggers
    trigger_service = get_trigger_service()
    trigger_service.clear_all()

    return ChatHistoryClearResponse()


__all__ = ["router"]
