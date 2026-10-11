"""Execution-only worker boundary shared by chat and scheduled requests."""
import asyncio
from dataclasses import dataclass, field
from datetime import datetime
from contextlib import asynccontextmanager
from typing import Dict, Optional
from .runtime import ExecutionAgentRuntime, ExecutionResult
from ...services.execution import get_execution_agent_logs
from ...services.execution.directory import get_task_directory

# One lock per canonical worker, shared by every manager in this process.
@dataclass
class _TaskGate:
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    users: int = 0

_TASK_LOCKS: Dict[str, _TaskGate] = {}

@asynccontextmanager
async def task_gate(name):
    gate = _TASK_LOCKS.setdefault(name, _TaskGate())
    # Count waiters before the first await so cleanup cannot bypass queued work.
    gate.users += 1
    try:
        async with gate.lock:
            yield
    finally:
        gate.users -= 1
        if gate.users == 0 and _TASK_LOCKS.get(name) is gate:
            del _TASK_LOCKS[name]


@dataclass
class PendingExecution:
    """Legacy import compatibility; request bookkeeping now belongs to coordinator."""
    request_id: str
    agent_name: str
    instructions: str
    batch_id: str
    created_at: datetime = field(default_factory=datetime.now)

class ExecutionBatchManager:
    def __init__(self, timeout_seconds: int = 90):
        self.timeout_seconds = timeout_seconds

    async def execute_agent(self, agent_name: str, instructions: str, request_id: Optional[str] = None,
                            on_start=None) -> ExecutionResult:
        if get_task_directory().has_collision(agent_name):
            return ExecutionResult(agent_name=agent_name, success=False, response="Task history is ambiguous", error="Legacy history collision; manual resolution required")
        async with task_gate(agent_name):
            # Recheck after queueing, before recording or reading any worker history.
            if get_task_directory().has_collision(agent_name):
                return ExecutionResult(agent_name=agent_name, success=False, response="Task history is ambiguous", error="Legacy history collision; manual resolution required")
            if on_start:
                on_start()
            get_execution_agent_logs().record_request(agent_name, instructions)
            try:
                runtime = ExecutionAgentRuntime(agent_name=agent_name)
                return await asyncio.wait_for(runtime.execute(instructions), timeout=self.timeout_seconds)
            except asyncio.TimeoutError:
                return ExecutionResult(agent_name=agent_name, success=False, response=f"Execution timed out after {self.timeout_seconds} seconds", error="Timeout; effects may have occurred")
            except Exception as exc:
                return ExecutionResult(agent_name=agent_name, success=False, response=f"Execution failed: {exc}", error=str(exc))

    def get_pending_executions(self):
        return []

    async def shutdown(self):
        pass
