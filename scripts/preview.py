"""Serve disposable sample task history, without keys, Gmail or real runtime data."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--port", type=int, default=8001)
parser.add_argument("--demo", action="store_true", help="Use deterministic fake models with external HTTP blocked")
parser.add_argument("--empty", action="store_true", help="Preview empty history instead of samples")
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent

with tempfile.TemporaryDirectory(prefix="openpoke-preview-") as temporary:
    target = Path(temporary)
    shutil.copytree(root / "server", target / "server", ignore=shutil.ignore_patterns("data", "__pycache__", "*.pyc", "venv"))
    environment = {**os.environ, "PYTHONPATH": str(target), "OPENROUTER_API_KEY": "", "COMPOSIO_API_KEY": "", "COMPOSIO_GMAIL_AUTH_CONFIG_ID": ""}
    if not args.empty:
        subprocess.run([sys.executable, "-c", '''
from server.services.execution.roster import get_agent_roster
from server.services.execution.log_store import get_execution_agent_logs
names = ["Sample · Book club plan", "Sample · Reading reminder", "Sample · Reply to Nora", "Sample / Shared history", "Sample Shared history"] + [f"Sample · Research notes {i:02d}" for i in range(1, 25)]
roster, logs = get_agent_roster(), get_execution_agent_logs()
for name in names: roster.add_agent(name)
for i in range(25):
    logs.record_request(names[0], f"Sample request {i + 1}: Help me prepare a small book club discussion.")
    logs.record_agent_response(names[0], f"Sample response {i + 1}: Pick one short reading and two questions. Keep the first meeting relaxed.")
logs.record_request(names[1], "Sample: Remind me to read this weekend. No live reminder exists in this preview.")
logs.record_agent_response(names[1], "Sample saved response only; nothing is scheduled.")
logs.record_request(names[2], "Sample: Draft a friendly reply to Nora. No email account is connected.")
logs.record_agent_response(names[2], "Sample: Thanks for the invitation. Saturday afternoon works for me.")
'''], cwd=target, env=environment, check=True)
    print("Disposable preview: sample data only; model and Gmail keys are disabled.", flush=True)
    command = [sys.executable, str(root / "scripts/offline_demo.py"), "--port", str(args.port)] if args.demo else [sys.executable, "-m", "server.server", "--host", "127.0.0.1", "--port", str(args.port)]
    process = subprocess.Popen(command, cwd=target, env=environment)
    try:
        raise SystemExit(process.wait())
    except KeyboardInterrupt:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
