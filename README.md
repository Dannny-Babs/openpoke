# OpenPoke

A conversational assistant with saved task workers. This take-home adds bounded worker discovery, an interface for reviewing ongoing work, and explicit task continuation.

Review the [implementation on main](https://github.com/Dannny-Babs/openpoke/tree/main). Start with the offline demo below, then follow the [two-minute walkthrough](docs/walkthrough.md). [Engineering decisions](docs/tradeoffs.md) explains the approach and tradeoffs.

## What changed

- The Interaction Agent receives up to eight workers and 4,096 serialized UTF-8 bytes, with paginated search over the full saved roster.
- Continue this task selects an existing worker by its exact ID. Each request owns its worker runs and results; work on the same worker is serialized.
- The frontend adds saved-task search and history, a prompt bar, received streaming output, activity filters and email-shaped draft cards. It distinguishes a saved draft from an incomplete response.

The directory bound reduces one source of prompt growth. Older-task paraphrase lookup and long conversation histories still have limitations.

## Quick start: offline demo

Prerequisites: Python 3.12, Node.js 20.9 or later, and npm. The recorded clean setup used macOS, Python 3.12.13 and Node 26/npm 11. Dependencies are pinned in `server/requirements.lock` and `web/package-lock.json`.

```sh
git clone --branch main https://github.com/Dannny-Babs/openpoke.git
cd openpoke
python3.12 -m venv .venv
.venv/bin/python -m pip install -r server/requirements.lock
npm ci --prefix web
```

From the repository root, start the backend:

```sh
.venv/bin/python scripts/preview.py --demo
```

In a second terminal, also at the repository root:

```sh
OPENPOKE_DEMO=1 PY_SERVER_URL=http://127.0.0.1:8001 npm run dev --prefix web -- --hostname 127.0.0.1 --port 3000
```

Open [localhost:3000](http://127.0.0.1:3000). Backend health is at [localhost:8001/api/v1/health](http://127.0.0.1:8001/api/v1/health). Stop both processes with Ctrl+C.

No API keys are required. Replies are scripted, external HTTP is blocked, and sample reminders do not run. The backend uses temporary data and deletes it on exit; existing `server/data/` is untouched. These responses demonstrate interaction behavior, not model quality. Use `--empty` on the backend command to omit sample history.

If a port is occupied, choose an unused one. Change the backend's `--port` and the frontend's `PY_SERVER_URL` together; set the frontend port with `--port`.

## Live models and persistent data

Stop the demo first. Create `.env` without overwriting an existing file:

```sh
if [ ! -e .env ]; then cp .env.example .env; fi
```

Enter secrets in your local editor. Shell variables override `.env`; the file is ignored by Git.

| Variable | Purpose |
| --- | --- |
| `OPENROUTER_API_KEY` | Required for live model replies. Calls may incur charges. |
| `COMPOSIO_API_KEY`, `COMPOSIO_GMAIL_AUTH_CONFIG_ID` | Optional Gmail integration, followed by authorization in Settings. |
| `PY_SERVER_URL` | Frontend proxy target, supplied in the commands below. |
| `OPENPOKE_DEMO=1` | Enables the offline demo label and disables frontend integration controls. Omit it for the persistent app. |

Start the persistent backend and frontend in separate terminals:

```sh
.venv/bin/python -m server.server --host 127.0.0.1 --port 8001
```

```sh
PY_SERVER_URL=http://127.0.0.1:8001 npm run dev --prefix web -- --hostname 127.0.0.1 --port 3000
```

Data lives in `server/data/`. Restart marks unfinished requests interrupted without replaying them. Run one backend process and keep it on loopback: the app has no account-level access control. Connected Gmail tools can change a mailbox; the draft display does not enforce tool approvals.

### Optional isolated model test

For real replies with fictional, temporary history and Gmail disabled, use this backend instead of the persistent one:

```sh
.venv/bin/python scripts/live_preview.py --model anthropic/claude-sonnet-4 --budget-usd 2 --budget-ledger /tmp/openpoke-approved-test-budget.json
```

```sh
OPENPOKE_LIVE_TEST=1 OPENPOKE_LIVE_BUDGET_USD=2 PY_SERVER_URL=http://127.0.0.1:8001 npm run dev --prefix web -- --hostname 127.0.0.1 --port 3000
```

Choose this mode only after approving model spending. This profile reserves up to US$2 across ten calls; one request can use several calls. Input is capped at 24,000 UTF-8 bytes and output at 1,536 tokens. Reservations are upper bounds, not measured charges. Reuse the same budget file across restarts; a new file starts a new budget. External worker tools and background jobs are disabled. Temporary app data is deleted on exit, while the budget file remains.

## Checks and limitations

The repository previously recorded 55 backend tests and 36 offline browser checks passing, plus lint and production build. Those checks were not rerun for this documentation pass.

```sh
.venv/bin/python scripts/test_backend.py
npm run lint --prefix web
npm run build --prefix web
npm exec --prefix web -- playwright install chromium --only-shell
npm run test:browser --prefix web
```

Backend tests use copied source and temporary stores. Browser checks start disposable offline servers on ports 8003 and 3013; those ports must be free. They test routing boundaries, continuation, concurrency, failures, streaming and keyboard/mobile interactions without model calls or mailbox actions. A production frontend preview uses `npm run start --prefix web` after the build, with the same environment variables and hostname/port arguments as the dev command.

Live tests remain a small sample. Name-based search missed an older task described with different wording, and growing context hit the isolated test input cap. Worker-directory limits do not bound the whole prompt or worker history. Physical-device, screen-reader and real Gmail behavior remain unverified. The last recorded production dependency audit found zero vulnerabilities; development/build-tool advisories remain. See [tradeoffs](docs/tradeoffs.md) for the remaining work.

## License

[MIT](LICENSE). Based on [shlokkhemani/openpoke](https://github.com/shlokkhemani/openpoke). Adapted Beautiful UI components and installed libraries are attributed in [third-party notices](THIRD_PARTY_NOTICES.md).
