"""Repeatable fixture routing evaluation against the capped temporary server."""
import argparse
import json
from pathlib import Path
import time
import uuid
import httpx


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:8001/api/v1")
    parser.add_argument("--submit", action="store_true", help="Explicitly submit evaluation requests; live servers may spend their approved budget")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--case", choices=["all", "continuation", "reuse", "separate", "fallback"], default="all")
    args = parser.parse_args()
    if not args.submit:
        parser.error("Use --submit only after selecting an offline or approved capped live test server")
    report = {"cases": [], "evidence": "Check server mode: scripted fixtures do not establish model routing quality"}
    with httpx.Client(timeout=10) as client:
        def submit(label, text, expected_name, explicit=False, create_new=False, fallback=False):
            matches = client.get(args.base_url + "/tasks", params={"q": expected_name}).raise_for_status().json()["tasks"]
            exact = next((task for task in matches if task["name"] == expected_name), None)
            if exact is None and not create_new:
                raise RuntimeError("Required temporary fixture is missing: " + expected_name)
            if create_new and exact is not None:
                raise RuntimeError("New-task fixture already exists; use fresh isolated test data")
            shortlist = None
            if fallback:
                observed = client.get(args.base_url + "/test/observations", params={"query": text}).raise_for_status().json()
                shortlist = [task["id"] for task in observed["directory"]["tasks"]]
                if exact["id"] in shortlist:
                    raise RuntimeError("Fallback fixture is in the initial shortlist; refusing to mislabel this test")
            started = time.monotonic()
            payload = {"messages": [{"role": "user", "content": text}], "submission_id": str(uuid.uuid4())}
            if explicit:
                payload["task_id"] = exact["id"]
            accepted = client.post(args.base_url + "/chat/send", json=payload).raise_for_status().json()
            ack_ms = round((time.monotonic() - started) * 1000)
            first_partial_ms = None
            samples = []
            while time.monotonic() - started < 90:
                body = client.get(args.base_url + "/chat/requests/" + accepted["request_id"]).raise_for_status().json()
                for run in body["runs"]:
                    if run.get("partial_response"):
                        if first_partial_ms is None:
                            first_partial_ms = round((time.monotonic() - started) * 1000)
                        length = len(run["partial_response"])
                        if not samples or samples[-1] != length:
                            samples.append(length)
                if body["status"] in {"succeeded", "failed", "interrupted"}:
                    if create_new:
                        found = client.get(args.base_url + "/tasks", params={"q": expected_name}).raise_for_status().json()["tasks"]
                        exact = next((task for task in found if task["name"] == expected_name), None)
                    result = {"ack_ms": ack_ms, "first_partial_ms": first_partial_ms, "terminal_ms": round((time.monotonic() - started) * 1000), "case": label, "request_id": body["request_id"], "status": body["status"], "error": body["error"], "expected_task_id": exact["id"] if exact else None, "actual_task_ids": [run["task_id"] for run in body["runs"]], "partial_lengths": samples}
                    result["passed"] = body["status"] == "succeeded" and exact is not None and result["actual_task_ids"] == [exact["id"]]
                    if fallback:
                        observed = client.get(args.base_url + "/test/observations", params={"request_id": body["request_id"]}).raise_for_status().json()
                        result["initial_shortlist_ids"] = shortlist
                        result["routing_tools"] = observed["tools"]
                        result["passed"] = result["passed"] and any(tool["tool"] == "search_execution_agents" and tool["success"] for tool in observed["tools"])
                    # Fictional output is included for a human semantic review, separate from IDs.
                    result["responses"] = [run.get("response") for run in body["runs"]]
                    replies = client.get(args.base_url + "/chat/history").raise_for_status().json()["messages"]
                    result["user_visible_replies"] = [message["content"] for message in replies if message.get("request_id") == body["request_id"] and message["role"] != "user"]
                    report["cases"].append(result)
                    print(json.dumps(result), flush=True)
                    return
                time.sleep(.15)
            raise RuntimeError("Timed out; request was not automatically resent")
        if args.case in {"all", "continuation"}:
            submit("exact continuation", "I am Daniel, the candidate; Nora is the recruiter. Revise my saved draft to thank her for inviting me to interview and say Friday works. Ask her to suggest a time. To, Subject, body under 80 words. Draft only.", "Nora interview draft", explicit=True)
        if args.case in {"all", "reuse"}:
            submit("older worker model reuse", "Continue the saved Lisbon museum plan with its existing worker. Suggest two indoor alternatives to previous ideas. Opening hours are unverified; no external research. This is unrelated to Nora.", "Lisbon museum plan")
        if args.case == "fallback":
            submit("worker absent from shortlist uses fallback", "Return to our Portugal art outing; locate its existing saved worker rather than creating a new one. Suggest two indoor alternatives to previous ideas. Opening hours are unverified; no external research.", "Lisbon museum plan", fallback=True)
        if args.case in {"all", "separate"}:
            submit("separate new task", "Create a separate task named Reading list fixture and delegate it to a new worker. Suggest three short public-domain classics for a beginner, with one sentence each. Use only general knowledge; no web research, downloads or external actions. This is unrelated to Nora or Lisbon.", "Reading list fixture", create_new=True)
    if args.output:
        args.output.write_text(json.dumps(report, indent=2))
    raise SystemExit(0 if all(case["passed"] for case in report["cases"]) else 1)


if __name__ == "__main__":
    main()
