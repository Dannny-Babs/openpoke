"""Capped, temporary OpenRouter test server. Gmail and external tools are disabled."""
import argparse
from decimal import Decimal
import fcntl
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

MODEL = "google/gemini-2.5-flash-lite"
MAX_CALLS = 20
MAX_INPUT_BYTES = 48_000
PROFILES = {MODEL: (20, .10, 48_000, .2, 1), "anthropic/claude-sonnet-4": (10, .20, 24_000, 3, 15)}
MAX_OUTPUT_TOKENS = 1536


def serve(port, max_calls, ledger, model, budget_usd=2):
    profile_limit, reservation, input_limit, prompt_price, output_price = PROFILES[model]
    import httpx
    import uvicorn
    from server.config import get_settings
    settings = get_settings()
    if not settings.openrouter_api_key:
        raise SystemExit("No saved OpenRouter key found. Enter it locally in .env.")
    settings.composio_api_key = None
    settings.composio_gmail_auth_config_id = None
    settings.conversation_summary_threshold = 0
    settings.interaction_agent_model = model
    settings.execution_agent_model = model
    # Even if a model asks for a tool, there is no Gmail/search/scheduling execution.
    import server.agents.execution_agent.runtime as execution
    execution.get_tool_registry = lambda **kwargs: {}
    execution.get_tool_schemas = lambda: []
    import server.agents.interaction_agent.runtime as interaction
    original_schemas = interaction.get_tool_schemas
    allowed = {"search_execution_agents", "send_message_to_existing_agent", "send_message_to_agent", "send_message_to_user", "send_draft", "wait"}
    interaction.get_tool_schemas = lambda: [t for t in original_schemas() if t["function"]["name"] in allowed]
    from server.services.execution.roster import get_agent_roster
    from server.services.execution.log_store import get_execution_agent_logs
    roster, logs = get_agent_roster(), get_execution_agent_logs()
    names = ["Lisbon museum plan", "Nora interview draft"] + [f"Fictional research task {i:03d}" for i in range(120)]
    for name in names:
        roster.add_agent(name)
    logs.record_request("Nora interview draft", "Draft only to nora@example.invalid. No email has been sent.")
    logs.record_agent_response("Nora interview draft", "To: nora@example.invalid\nSubject: Interview availability\n\nHi Nora, thanks for the invitation. Best, Daniel")
    logs.record_request("Lisbon museum plan", "A fictional Lisbon trip; prefer museums and indoor walks. Use no live research claims.")
    logs.record_agent_response("Lisbon museum plan", "We considered MAAT and the tile museum. These suggestions have not been verified for opening hours.")
    # Recent unrelated workers keep the older fixtures outside an unmatching shortlist.
    for name in names[-8:]:
        logs.record_agent_response(name, "Fictional saved research notes; no external work performed.")
    # Observe actual routing tools, correlated to each request; never alter their result.
    from server.services.execution.request_context import current_request
    observations = []
    original_tool = interaction.handle_tool_call
    def observed_tool(name, arguments):
        result = original_tool(name, arguments)
        owner = current_request.get()
        observations.append({"request_id": owner.request_id if owner else None, "tool": name, "success": result.success})
        return result
    interaction.handle_tool_call = observed_tool
    # Keep an explicit test-only tool constraint above both legacy system prompts.
    old_execute = execution.ExecutionAgentRuntime._make_llm_call
    async def constrained_execute(self, system_prompt, messages, with_tools=True):
        return await old_execute(self, "ISOLATED MODEL TEST: You have no external tools. Draft and reason from supplied information only. Never claim to search, send, schedule, or verify live facts. Do not offer to send later or ask for approval to send while external tools are disabled; offer draft edits or manual copying only.\n" + system_prompt, messages, with_tools)
    execution.ExecutionAgentRuntime._make_llm_call = constrained_execute
    old_interaction = interaction.InteractionAgentRuntime._make_llm_call
    async def constrained_interaction(self, system_prompt, messages):
        return await old_interaction(self, "ISOLATED MODEL TEST: Gmail, reminders and external research are disabled. Worker results are drafts or suggestions only. Do not claim external actions. Do not say you are ready to send, offer sending later, or ask for approval to send while integrations are disabled; offer draft edits or manual copying only.\n" + system_prompt, messages)
    interaction.InteractionAgentRuntime._make_llm_call = constrained_interaction
    original_send = httpx.AsyncClient.send
    def reserve():
        # Shared receipt survives server restart and serializes concurrent servers.
        ledger.parent.mkdir(parents=True, exist_ok=True)
        with Path(str(ledger) + ".lock").open("a+") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            if ledger.exists():
                raw = ledger.read_text()
                if not raw.strip():
                    raise RuntimeError("Budget receipt is empty; refusing model calls until reviewed")
                previous = json.loads(raw)
            else:
                previous = {}
            if previous.get("model", model) != model:
                raise RuntimeError("Budget receipt belongs to another model; refusing calls")
            used = int(previous.get("calls_reserved", 0))
            limit = min(max_calls, int(previous.get("max_calls", max_calls)))
            if used >= limit:
                raise RuntimeError("Model test call budget exhausted; no automatic retry")
            used += 1
            body = {"approved_budget_usd": budget_usd, "calls_reserved": used, "max_calls": limit, "reserved_usd": round(used * reservation, 2), "maximum_reserved_usd": round(limit * reservation, 2), "model": model}
            staged = Path(str(ledger) + ".next")
            with staged.open("w") as receipt:
                json.dump(body, receipt)
                receipt.flush()
                os.fsync(receipt.fileno())
            os.replace(staged, ledger)
            return used
    async def guarded_send(self, request, *args, **kwargs):
        if request.url.scheme != "https" or request.url.host != "openrouter.ai" or request.url.path != "/api/v1/chat/completions" or request.method != "POST":
            raise RuntimeError("Only capped OpenRouter model calls are permitted in this test")
        payload = json.loads(request.content)
        if len(json.dumps({"messages": payload.get("messages"), "tools": payload.get("tools")}, ensure_ascii=False).encode()) > input_limit:
            raise RuntimeError("Test input budget exceeded; no model call was made")
        # Conservative profile reservation also allows cache pricing overhead.
        # Even timed-out calls consume a reservation within the explicit approval cap.
        calls = reserve()
        payload.update(model=model, max_tokens=MAX_OUTPUT_TOKENS,
                       provider={"max_price": {"prompt": prompt_price, "completion": output_price}, "require_parameters": True},
                       reasoning={"enabled": False})
        payload.pop("plugins", None)
        headers = {k:v for k,v in request.headers.items() if k.lower() != "content-length"}
        limited = httpx.Request("POST", request.url, headers=headers, json=payload, extensions=request.extensions)
        print(f"Isolated model test: reserved call {calls}/{max_calls}; Gmail disabled.", flush=True)
        return await original_send(self, limited, *args, **kwargs)
    httpx.AsyncClient.send = guarded_send
    def blocked(*args, **kwargs):
        raise RuntimeError("External integrations are disabled in this isolated model test")
    httpx.Client.send = blocked
    try:
        import requests
        requests.sessions.Session.request = blocked
    except ImportError:
        pass
    from server.app import app
    from fastapi import Query
    from server.services.execution.directory import get_task_directory
    @app.get("/api/v1/test/observations")
    def inspect_test(query: str = Query("", max_length=2048), request_id: str = Query("", max_length=36)):
        return {"directory": get_task_directory().context(query),
                "tools": [entry for entry in observations if not request_id or entry["request_id"] == request_id]}
    # Background startup cannot consume this approval's budget.
    from server.services import get_trigger_scheduler, get_important_email_watcher
    async def disabled_start():
        pass
    get_trigger_scheduler().start = disabled_start
    get_important_email_watcher().start = disabled_start
    print(f"Live model test: temporary fictional data; no Gmail; US${max_calls * reservation:.2f} maximum reservation within US${budget_usd} approval.", flush=True)
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning", access_log=False)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8001)
    parser.add_argument("--model", choices=list(PROFILES), default=MODEL)
    parser.add_argument("--budget-usd", type=int, choices=[2, 5], default=2, help="Explicit approved budget; default US$2. Use US$5 only with new approval.")
    parser.add_argument("--max-calls", type=int, help="Optional lower call cap within the explicit approved budget")
    parser.add_argument("--budget-ledger", type=Path, required=True, help="Receipt path for this approved budget; reuse it across restarts")
    parser.add_argument("--serve-internal", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()
    profile_limit = int(Decimal(str(args.budget_usd)) / Decimal(str(PROFILES[args.model][1])))
    if args.max_calls is None:
        args.max_calls = profile_limit
    if not 1 <= args.max_calls <= profile_limit:
        parser.error(f"max-calls must be between 1 and {profile_limit} for this model (within US${args.budget_usd} reservation cap)")
    if args.serve_internal:
        serve(args.port, args.max_calls, args.budget_ledger, args.model, args.budget_usd)
        return
    root = Path(__file__).resolve().parent.parent
    from dotenv import dotenv_values
    saved = dotenv_values(root / ".env")
    key = os.environ.get("OPENROUTER_API_KEY") or saved.get("OPENROUTER_API_KEY")
    if not key:
        raise SystemExit("No saved OpenRouter key found. Enter it locally in .env.")
    with tempfile.TemporaryDirectory(prefix="openpoke-live-test-") as temporary:
        target = Path(temporary)
        shutil.copytree(root / "server", target / "server", ignore=shutil.ignore_patterns("data", "__pycache__", "*.pyc", "venv"))
        environment = {**os.environ, "PYTHONPATH": str(target), "OPENROUTER_API_KEY": key, "COMPOSIO_API_KEY": "", "COMPOSIO_GMAIL_AUTH_CONFIG_ID": ""}
        process = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), "--serve-internal", "--port", str(args.port), "--max-calls", str(args.max_calls), "--budget-usd", str(args.budget_usd), "--model", args.model, "--budget-ledger", str(args.budget_ledger.resolve())], cwd=target, env=environment)
        try:
            raise SystemExit(process.wait())
        except KeyboardInterrupt:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()


if __name__ == "__main__":
    main()
