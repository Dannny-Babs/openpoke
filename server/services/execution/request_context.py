"""Ownership propagated to routing tools and conversation events."""
from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Any, Optional

@dataclass
class RequestContext:
    coordinator: Any
    request_id: str
    task_id: Optional[str] = None
    run_id: Optional[str] = None
    stream_text: str = ""
    stream_updated_at: float = 0.0
    pending: list = field(default_factory=list)
    replies: int = 0

current_request: ContextVar[Optional[RequestContext]] = ContextVar("openpoke_request", default=None)
