"""Deterministic model fixtures for the disposable preview, never a live provider."""
import argparse
import asyncio
import json
import re

import httpx
import uvicorn

from server.config import get_settings
from server.agents.interaction_agent.runtime import InteractionAgentRuntime
from server.agents.execution_agent.runtime import ExecutionAgentRuntime


async def blocked_async_send(*args, **kwargs):
    raise RuntimeError("External HTTP calls are disabled in the offline demo")


def blocked_send(*args, **kwargs):
    raise RuntimeError("External HTTP calls are disabled in the offline demo")


def completion(content="", tool=None, arguments=None):
    message = {"role": "assistant", "content": content}
    if tool:
        message["tool_calls"] = [{"id": "offline-fixture-call", "type": "function", "function": {
            "name": tool, "arguments": json.dumps(arguments or {})}}]
    return {"choices": [{"message": message}]}


async def interaction_fixture(self, system_prompt, messages):
    await asyncio.sleep(0.15)  # Deliberate demo latency, not a provider benchmark.
    if messages[-1].get("role") == "tool":
        return completion()
    text = messages[-1].get("content", "")
    if "<new_agent_message>" in text:
        result = text.rsplit("<new_agent_message>", 1)[1].split("</new_agent_message>", 1)[0].strip()
        # Keep errors visible; the coordinator determines the terminal outcome.
        result = re.sub(r"^\[(?:SUCCESS|FAILED)\] [^:]+: ", "", result)
        draft = re.match(r"^To: ([^\n]+)\nSubject: ([^\n]+)\n\n(.*)$", result, re.DOTALL)
        if draft:
            return completion(tool="send_draft", arguments={"to": draft.group(1), "subject": draft.group(2), "body": draft.group(3)})
        return completion(tool="send_message_to_user", arguments={"message": result})
    request = text.rsplit("<new_user_message>", 1)[-1].split("</new_user_message>", 1)[0].strip()
    from server.services.execution.directory import get_task_directory
    names = get_task_directory().names()
    if "nora" in request.lower() or "email" in request.lower():
        name = next((n for n in names if "nora" in n.lower()), "Demo · Email to Nora")
    elif "subscription" in request.lower():
        name = "Demo · Subscription review"
    elif "book" in request.lower():
        name = next((n for n in names if "book club" in n.lower()), "Demo · Book club plan")
    else:
        name = "Demo · General task"
    return completion(tool="send_message_to_agent", arguments={"agent_name": name, "instructions": request})


async def execution_fixture(self, system_prompt, messages, with_tools=True):
    request = messages[0].get("content", "")
    await asyncio.sleep(3 if "slow" in request.lower() else 0.6)
    if "fail" in request.lower():
        raise RuntimeError("Simulated read failure. No external operation was attempted.")
    if "nora" in self.agent.name.lower() or "email" in self.agent.name.lower():
        body = "Thanks for the interview invitation. Friday works for me—please let me know what time suits you." if "friday" in request.lower() else "Thank you for inviting me to interview. I’m looking forward to learning more about the role. Please let me know which times work for you."
        answer = "To: nora@example.invalid\nSubject: Interview availability\n\nHi Nora,\n\n" + body + "\n\nBest,\nDaniel"
    elif "subscription" in self.agent.name.lower():
        answer = "Offline example: a subscription review would collect receipts, state the date range checked, and flag uncertain candidates for your review. No mailbox was searched and nothing was cancelled."
    else:
        answer = "Offline example result for: " + request + "\n\nThis response is deterministic sample data. No research, reminder or external action was performed."
    return completion(answer)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8001)
    args = parser.parse_args()
    # The preview wrapper supplies a temporary copied server and blank Gmail keys.
    settings = get_settings()
    settings.openrouter_api_key = "offline-demo-placeholder"
    settings.composio_api_key = None
    settings.composio_gmail_auth_config_id = None
    settings.conversation_summary_threshold = 0
    httpx.AsyncClient.send = blocked_async_send
    httpx.Client.send = blocked_send
    try:
        import requests
        requests.sessions.Session.request = blocked_send
    except ImportError:
        pass
    InteractionAgentRuntime._make_llm_call = interaction_fixture
    ExecutionAgentRuntime._make_llm_call = execution_fixture
    from server.app import app
    print("Offline demo: deterministic model fixtures; all external HTTP calls blocked.", flush=True)
    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning", access_log=False)


if __name__ == "__main__":
    main()
