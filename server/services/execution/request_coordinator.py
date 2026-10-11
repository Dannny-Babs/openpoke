"""Request-owned phases, retained tasks and conservative completion semantics."""
import asyncio
import time
from pathlib import Path
from .request_context import RequestContext, current_request
from .request_store import RequestStore, TERMINAL
from .directory import get_task_directory, task_id as identify_task

class RequestCoordinator:
    MAX_PHASES = 3
    def __init__(self, store):
        self.store = store
        self._tasks = {}
        self._closing = False

    def start(self):
        self.store.interrupt_open()
        self._closing = False

    def submit(self, text, task_id=None, submission_id=None, origin="chat", task_name=None):
        if self._closing:
            raise RuntimeError("Server is stopping; request was not accepted")
        if task_id:
            task_name = get_task_directory().resolve(task_id)
        if task_name and get_task_directory().has_collision(task_name):
            raise ValueError("Legacy task history collision; manual resolution required")
        body, created = self.store.create(text, task_id, origin, submission_id)
        if created:
            task = asyncio.create_task(self._process(body, text, task_name), name=f"request-{body['request_id']}")
            self._tasks[body["request_id"]] = task
            task.add_done_callback(lambda _: self._tasks.pop(body["request_id"], None))
        return body

    def register_worker(self, name, instructions, manager):
        context = current_request.get()
        if context is None or context.coordinator is not self:
            raise RuntimeError("Worker execution requires a request owner")
        identifier = identify_task(name)
        run = self.store.add_run(context.request_id, identifier, name)
        async def execute():
            token = current_request.set(RequestContext(self, context.request_id, identifier, run_id=run["id"]))
            try:
                def started():
                    self.store.update_run(context.request_id, run["id"], status="running")
                    self.store.update(context.request_id, status="running")
                result = await manager.execute_agent(name, instructions, request_id=run["id"], on_start=started)
                self.store.update_run(context.request_id, run["id"], status="succeeded" if result.success else "failed",
                                      error=result.error, response=result.response)
                return result
            except asyncio.CancelledError:
                self.store.update_run(context.request_id, run["id"], status="interrupted", error="Execution interrupted; effects may have occurred")
                raise
            except Exception as exc:
                self.store.update_run(context.request_id, run["id"], status="failed", error=str(exc))
                raise
            finally:
                current_request.reset(token)
        task = asyncio.create_task(execute(), name=f"worker-{run['id']}")
        context.pending.append(task)
        return run

    def begin_completion(self):
        context = current_request.get()
        if context is None or context.coordinator is not self or not context.run_id:
            return
        context.stream_text = ""
        context.stream_updated_at = 0.0
        self.store.update_run(context.request_id, context.run_id, partial_response=None, activity=None)

    def stream_content(self, fragment):
        context = current_request.get()
        if context is None or context.coordinator is not self or not context.run_id:
            return  # Router/finalizer model prose is private, including ordinary planning.
        context.stream_text = (context.stream_text + fragment).encode("utf-8")[:8192].decode("utf-8", "ignore")
        stamp = time.monotonic()
        if stamp - context.stream_updated_at >= 0.25:
            self.store.update_run(context.request_id, context.run_id, partial_response=context.stream_text)
            context.stream_updated_at = stamp

    def tool_activity(self, name, status):
        context = current_request.get()
        if context is None or context.coordinator is not self or not context.run_id:
            return
        self.store.update_run(context.request_id, context.run_id, partial_response=None,
                              activity={"name": name, "status": status})

    async def _process(self, body, text, name):
        from ...agents.interaction_agent.runtime import InteractionAgentRuntime
        from ...agents.interaction_agent.tools import _EXECUTION_BATCH_MANAGER
        from ..conversation import get_conversation_log
        context = RequestContext(self, body["request_id"], body["task_id"])
        token = current_request.set(context)
        all_workers = []
        failed = False
        try:
            if name:
                if body["origin"] == "chat":
                    get_conversation_log().record_user_message(text)
                self.register_worker(name, text, _EXECUTION_BATCH_MANAGER)
            else:
                self.store.update(context.request_id, status="routing")
                runtime = InteractionAgentRuntime()
                result = await runtime.execute(text) if body["origin"] == "chat" else await runtime.handle_agent_message(text)
                if not result.success:
                    raise RuntimeError(result.error or "Routing failed")
                if not context.pending and result.response and not context.replies:
                    get_conversation_log().record_reply(result.response)
            for _ in range(self.MAX_PHASES):
                # Routing/finalization has returned: this phase is now sealed.
                pending, context.pending = context.pending, []
                all_workers.extend(pending)
                if not pending:
                    break
                results = await asyncio.gather(*pending)
                failed = failed or any(not result.success for result in results)
                payload = "\n".join(f"[{'SUCCESS' if r.success else 'FAILED'}] {r.agent_name}: {r.response}" for r in results)
                names = {run["task_id"] for run in self.store.get(context.request_id)["runs"]}
                context.task_id = next(iter(names)) if len(names) == 1 else None
                self.store.update(context.request_id, status="responding")
                before = context.replies
                result = await InteractionAgentRuntime().handle_agent_message(payload)
                if not result.success:
                    raise RuntimeError(result.error or "Response generation failed; worker effects may have occurred")
                if result.response and context.replies == before:
                    get_conversation_log().record_reply(result.response)
                if context.replies == before and not context.pending:
                    raise RuntimeError("No final user-facing response was recorded for worker results")
            if context.pending:
                raise RuntimeError("Additional execution phase limit reached")
            if not context.replies:
                raise RuntimeError("No user-facing response was recorded")
            self.store.update(context.request_id, status="failed" if failed else "succeeded",
                              error="One or more worker operations failed; inspect run results for partial work" if failed else None)
        except asyncio.CancelledError:
            self.store.update(context.request_id, status="interrupted", error="Server stopped; work may have occurred. No automatic replay.")
            raise
        except Exception as exc:
            self.store.update(context.request_id, status="failed", error=str(exc))
        finally:
            remaining = all_workers + context.pending
            for task in remaining:
                if not task.done():
                    task.cancel()
            if remaining:
                await asyncio.gather(*remaining, return_exceptions=True)
            def close_unstarted(body):
                for run in body["runs"]:
                    if run["status"] not in TERMINAL:
                        run.update(status="interrupted", partial_response=None, activity=None, error="Request ended before this worker finished")
            self.store.mutate(context.request_id, close_unstarted)
            current_request.reset(token)

    async def wait(self, identifier):
        task = self._tasks.get(identifier)
        if task:
            await asyncio.shield(task)
        return self.store.get(identifier)

    def has_active_work(self):
        return any(not task.done() for task in self._tasks.values())

    async def shutdown(self):
        self._closing = True
        tasks = list(self._tasks.values())
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        self.store.interrupt_open()

_coordinator = None

def get_request_coordinator():
    global _coordinator
    if _coordinator is None:
        path = Path(__file__).resolve().parents[2] / "data" / "requests.sqlite3"
        _coordinator = RequestCoordinator(RequestStore(path))
    return _coordinator
