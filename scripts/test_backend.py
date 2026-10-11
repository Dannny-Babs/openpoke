"""Run backend checks in disposable storage; never load the user's runtime data."""
from pathlib import Path
import os
import shutil
import subprocess
import sys
import tempfile

root = Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix="openpoke-tests-") as temporary:
    target = Path(temporary)
    shutil.copytree(root / "server", target / "server", ignore=shutil.ignore_patterns("data", "__pycache__", "*.pyc", "venv"))
    environment = {**os.environ, "PYTHONPATH": str(target), "OPENROUTER_API_KEY": "", "COMPOSIO_API_KEY": "", "COMPOSIO_GMAIL_AUTH_CONFIG_ID": ""}
    for arguments in (["-m", "compileall", "-q", "server"], ["-m", "unittest", "discover", "-s", "server/tests", "-t", ".", "-v"]):
        result = subprocess.run([sys.executable, *arguments], cwd=target, env=environment)
        if result.returncode:
            raise SystemExit(result.returncode)
