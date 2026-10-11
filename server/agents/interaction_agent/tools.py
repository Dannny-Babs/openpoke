"""Tool definitions for interaction agent."""

import asyncio
import json
from dataclasses import dataclass
from typing import Any, Optional

from ...logging_config import logger
from ...services.conversation import get_conversation_log
from ...services.execution import get_agent_roster, get_execution_agent_logs
from ..execution_agent.batch_manager import ExecutionBatchManager
from ...services.execution.directory import get_task_directory


@dataclass
class ToolResult:
    """Standardized payload returned by interaction-agent tools."""

    success: bool
    payload: Any = None
    user_message: Optional[str] = None
    recorded_reply: bool = False

# Tool schemas for OpenRouter
TOOL_SCHEMAS = [
    {
        "type": "function",
        "function": {
            "name": "search_execution_agents",
            "description": "Search the COMPLETE persistent worker directory, including older tasks omitted from the initial shortlist. Results are bounded; use next_cursor for more matches. Empty query browses the directory.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "maxLength": 2048},
                    "cursor": {"type": "string", "maxLength": 64},
                },
                "required": ["query"], "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "send_message_to_existing_agent",
            "description": "Reuse the exact existing worker identified by the directory ID. Never creates a replacement. Use this after directory search, especially when its display name is truncated.",
            "parameters": {
                "type": "object",
                "properties": {
                    "task_id": {"type": "string", "pattern": "^[0-9a-f]{64}$"},
                    "instructions": {"type": "string"},
                },
                "required": ["task_id", "instructions"], "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "send_message_to_agent",
            "description": "Deliver instructions to a specific execution agent. Creates a new agent if the name doesn't exist in the roster, or reuses an existing one.",
            "parameters": {
                "type": "object",
                "properties": {
                    "agent_name": {
                        "type": "string",
                        "description": "Human-readable agent name describing its purpose (e.g., 'Vercel Job Offer', 'Email to Sharanjeet'). This name will be used to identify and potentially reuse the agent."
                    },
                    "instructions": {"type": "string", "description": "Instructions for the agent to execute."},
                },
                "required": ["agent_name", "instructions"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "send_message_to_user",
            "description": "Deliver a natural-language response directly to the user. Use this for updates, confirmations, or any assistant response the user should see immediately.",
            "parameters": {
                "type": "object",
                "properties": {
                    "message": {
                        "type": "string",
                        "description": "Plain-text message that will be shown to the user and recorded in the conversation log.",
                    },
                },
                "required": ["message"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "send_draft",
            "description": "Record an email draft so the user can review the exact text.",
            "parameters": {
                "type": "object",
                "properties": {
                    "to": {
                        "type": "string",
                        "description": "Recipient email for the draft.",
                    },
                    "subject": {
                        "type": "string",
                        "description": "Email subject for the draft.",
                    },
                    "body": {
                        "type": "string",
                        "description": "Email body content (plain text).",
                    },
                },
                "required": ["to", "subject", "body"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "wait",
            "description": "Wait silently when a message is already in conversation history to avoid duplicating responses. Adds a <wait> log entry that is not visible to the user.",
            "parameters": {
                "type": "object",
                "properties": {
                    "reason": {
                        "type": "string",
                        "description": "Brief explanation of why waiting (e.g., 'Message already sent', 'Draft already created').",
                    },
                },
                "required": ["reason"],
                "additionalProperties": False,
            },
        },
    },
]

_EXECUTION_BATCH_MANAGER = ExecutionBatchManager()


# Create or reuse execution agent and dispatch instructions asynchronously
def send_message_to_agent(agent_name: str, instructions: str, *, require_existing: bool = False) -> ToolResult:
    """Send instructions to an execution agent."""
    if not isinstance(agent_name, str) or not agent_name.strip():
        return ToolResult(success=False, payload={"error": "A nonempty agent name is required"})
    if get_task_directory().has_collision(agent_name):
        return ToolResult(success=False, payload={"error": "This name shares a legacy history file with another task. Choose a distinct name for new work; existing mixed histories need manual resolution."})
    from ...services.execution.request_context import current_request
    context = current_request.get()
    if context is None:
        return ToolResult(success=False, payload={"error": "Worker execution requires a request owner"})
    roster = get_agent_roster()
    roster.load()
    existing_agents = set(roster.get_agents())
    is_new = agent_name not in existing_agents

    if is_new and require_existing:
        return ToolResult(success=False, payload={"error": "Task no longer exists. Search again without creating a replacement."})
    if is_new:
        roster.add_agent(agent_name)

    context.coordinator.register_worker(agent_name, instructions, _EXECUTION_BATCH_MANAGER)

    return ToolResult(
        success=True,
        payload={
            "status": "submitted",
            "agent_name": agent_name,
            "new_agent_created": is_new,
        },
    )


def search_execution_agents(query: str, cursor: Optional[str] = None) -> ToolResult:
    try:
        return ToolResult(success=True, payload=get_task_directory().page(query, cursor))
    except ValueError as exc:
        return ToolResult(success=False, payload={"error": str(exc)})


def send_message_to_existing_agent(task_id: str, instructions: str) -> ToolResult:
    try:
        name = get_task_directory().resolve(task_id)
    except KeyError:
        return ToolResult(success=False, payload={"error": "Task no longer exists. Search again; do not create a replacement for this follow-up."})
    return send_message_to_agent(name, instructions, require_existing=True)


# Send immediate message to user and record in conversation history
def send_message_to_user(message: str) -> ToolResult:
    """Record a user-visible reply in the conversation log."""
    log = get_conversation_log()
    log.record_reply(message)

    return ToolResult(
        success=True,
        payload={"status": "delivered"},
        user_message=message,
        recorded_reply=True,
    )


# Format and record email draft for user review
def send_draft(
    to: str,
    subject: str,
    body: str,
) -> ToolResult:
    """Record a draft update in the conversation log for the interaction agent."""
    log = get_conversation_log()

    message = f"To: {to}\nSubject: {subject}\n\n{body}"

    log.record_draft(to, subject, body)
    logger.info(f"Draft recorded for: {to}")

    return ToolResult(
        success=True,
        payload={
            "status": "draft_recorded",
            "to": to,
            "subject": subject,
        },
        user_message=message,
        recorded_reply=True,
    )


# Record silent wait state to avoid duplicate responses
def wait(reason: str) -> ToolResult:
    """Wait silently and add a wait log entry that is not visible to the user."""
    log = get_conversation_log()
    
    # Record a dedicated wait entry so the UI knows to ignore it
    log.record_wait(reason)
    

    return ToolResult(
        success=True,
        payload={
            "status": "waiting",
            "reason": reason,
        },
        recorded_reply=True,
    )


# Return predefined tool schemas for LLM function calling
def get_tool_schemas():
    """Return OpenAI-compatible tool schemas."""
    return TOOL_SCHEMAS


# Route tool calls to appropriate handlers with argument validation and error handling
def handle_tool_call(name: str, arguments: Any) -> ToolResult:
    """Handle tool calls from interaction agent."""
    try:
        if isinstance(arguments, str):
            args = json.loads(arguments) if arguments.strip() else {}
        elif isinstance(arguments, dict):
            args = arguments
        else:
            return ToolResult(success=False, payload={"error": "Invalid arguments format"})

        if name == "search_execution_agents":
            return search_execution_agents(**args)
        if name == "send_message_to_existing_agent":
            return send_message_to_existing_agent(**args)
        if name == "send_message_to_agent":
            return send_message_to_agent(**args)
        if name == "send_message_to_user":
            return send_message_to_user(**args)
        if name == "send_draft":
            return send_draft(**args)
        if name == "wait":
            return wait(**args)

        logger.warning("unexpected tool", extra={"tool": name})
        return ToolResult(success=False, payload={"error": f"Unknown tool: {name}"})
    except json.JSONDecodeError:
        return ToolResult(success=False, payload={"error": "Invalid JSON"})
    except TypeError as exc:
        return ToolResult(success=False, payload={"error": f"Missing required arguments: {exc}"})
    except Exception as exc:  # pragma: no cover - defensive
        logger.error("tool call failed", extra={"tool": name, "error": str(exc)})
        return ToolResult(success=False, payload={"error": "Failed to execute"})
