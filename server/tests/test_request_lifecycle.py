"""Offline lifecycle regression checks, exclusively temporary stores and fake workers."""
import asyncio
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from types import SimpleNamespace
from ..services.execution.request_store import RequestStore, SubmissionConflict
from ..services.execution.request_coordinator import RequestCoordinator
from ..services.execution.request_context import current_request
from ..agents.execution_agent.batch_manager import ExecutionBatchManager
from ..agents.execution_agent.runtime import ExecutionResult, ExecutionAgentRuntime
from ..agents.interaction_agent.runtime import InteractionResult
from ..agents.interaction_agent import tools
from ..services.execution.log_store import ExecutionAgentLogStore

class StoreTests(unittest.TestCase):
    def test_transport_dedup_distinguishes_same_text_and_conflicts(self):
        with tempfile.TemporaryDirectory() as folder:
            store = RequestStore(Path(folder)/"requests.db")
            first, created = store.create("same", submission_id="one")
            repeated, created = store.create("same", submission_id="one")
            self.assertFalse(created)
            self.assertEqual(first["request_id"], repeated["request_id"])
            separate, _ = store.create("same", submission_id="two")
            self.assertNotEqual(first["request_id"], separate["request_id"])
            with self.assertRaises(SubmissionConflict):
                store.create("different", submission_id="one")
            store.close()

    def test_restart_interrupts_only_open_work_without_replay(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder)/"requests.db"
            store = RequestStore(path)
            body, _ = store.create("work")
            run = store.add_run(body["request_id"], "task", "Task")
            store.update_run(body["request_id"], run["id"], status="running")
            done, _ = store.create("done")
            store.update(done["request_id"], status="succeeded")
            store.close()
            store = RequestStore(path)
            store.interrupt_open()
            self.assertEqual(store.get(body["request_id"])["runs"][0]["status"], "interrupted")
            self.assertEqual(store.get(done["request_id"])["status"], "succeeded")
            store.close()

class LifecycleTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.store = RequestStore(Path(self.folder.name)/"requests.db")
        self.coordinator = RequestCoordinator(self.store)
        self.logs = ExecutionAgentLogStore(Path(self.folder.name)/"logs")
        self.messages = []
        def reply(text):
            self.messages.append((current_request.get().request_id, current_request.get().task_id, text))
            current_request.get().replies += 1
        self.log = SimpleNamespace(record_user_message=lambda text: None, record_reply=reply)
        self.patches = [
            patch("server.services.execution.request_coordinator.get_task_directory", return_value=SimpleNamespace(resolve=lambda identifier: identifier, has_collision=lambda name: False)),
            patch("server.agents.execution_agent.batch_manager.get_task_directory", return_value=SimpleNamespace(has_collision=lambda name: False)),
            patch("server.agents.execution_agent.batch_manager.get_execution_agent_logs", return_value=self.logs),
            patch("server.services.conversation.get_conversation_log", return_value=self.log),
        ]
        for item in self.patches: item.start()

    async def asyncTearDown(self):
        await self.coordinator.shutdown()
        for item in reversed(self.patches): item.stop()
        self.store.close()
        self.folder.cleanup()

    def runtime(self, failed=False, no_reply=False):
        log = self.log
        class Runtime:
            async def handle_agent_message(self, text):
                if failed: return InteractionResult(False, "", error="Finalizer failed")
                if not no_reply: log.record_reply(text)
                return InteractionResult(True, "" if no_reply else text)
        return Runtime

    async def test_distinct_overlapping_requests_do_not_share_results(self):
        async def execute(name, instructions, **kwargs):
            kwargs["on_start"]()
            await asyncio.sleep(0)
            return ExecutionResult(name, True, instructions)
        with patch.object(tools._EXECUTION_BATCH_MANAGER, "execute_agent", side_effect=execute), patch("server.agents.interaction_agent.runtime.InteractionAgentRuntime", self.runtime()):
            a = self.coordinator.submit("First", task_id="A")
            b = self.coordinator.submit("Second", task_id="B")
            outcomes = await asyncio.gather(self.coordinator.wait(a["request_id"]), self.coordinator.wait(b["request_id"]))
        self.assertEqual([x["status"] for x in outcomes], ["succeeded", "succeeded"])
        self.assertEqual([x["runs"][0]["response"] for x in outcomes], ["First", "Second"])
        self.assertNotIn("Second", self.messages[0][2])
        self.assertIsNotNone(self.messages[0][1])

    async def test_chat_and_schedule_serialize_before_history_write(self):
        entered = asyncio.Event()
        release = asyncio.Event()
        observed = []
        logs = self.logs
        class Worker:
            def __init__(self, agent_name): self.name=agent_name
            async def execute(self, instructions):
                observed.append(logs.load_transcript(self.name))
                if instructions == "First":
                    entered.set()
                    await release.wait()
                logs.record_agent_response(self.name, "result:" + instructions)
                return ExecutionResult(self.name, True, instructions)
        with patch("server.agents.execution_agent.batch_manager.ExecutionAgentRuntime", Worker), patch("server.agents.interaction_agent.runtime.InteractionAgentRuntime", self.runtime()):
            a = self.coordinator.submit("First", task_id="Shared")
            await entered.wait()
            b = self.coordinator.submit("Second", task_id="Shared", origin="schedule")
            await asyncio.sleep(0)
            self.assertEqual(self.store.get(b["request_id"])["runs"][0]["status"], "queued")
            self.assertNotIn("Second", logs.load_transcript("Shared"))
            release.set()
            await asyncio.gather(self.coordinator.wait(a["request_id"]), self.coordinator.wait(b["request_id"]))
        self.assertNotIn("Second", observed[0])
        self.assertIn("result:First", observed[1])

    async def test_timeout_begins_after_queue(self):
        manager = ExecutionBatchManager(timeout_seconds=0.025)
        started = asyncio.Event()
        release = asyncio.Event()
        class Worker:
            def __init__(self, agent_name): self.name=agent_name
            async def execute(self, instructions):
                if instructions == "block":
                    started.set()
                    await release.wait()
                return ExecutionResult(self.name, True, instructions)
        with patch("server.agents.execution_agent.batch_manager.ExecutionAgentRuntime", Worker):
            # Different manager shares the task lock while first waits without a short timeout.
            first = asyncio.create_task(ExecutionBatchManager(timeout_seconds=1).execute_agent("queue", "block"))
            await started.wait()
            second = asyncio.create_task(manager.execute_agent("queue", "quick"))
            await asyncio.sleep(0.05)
            self.assertFalse(second.done())
            release.set()
            self.assertTrue((await second).success)
            await first

    async def test_failed_worker_cannot_become_successful_prose(self):
        async def execute(name, instructions, **kwargs):
            return ExecutionResult(name, False, "Partial result", error="Tool failed")
        with patch.object(tools._EXECUTION_BATCH_MANAGER, "execute_agent", side_effect=execute), patch("server.agents.interaction_agent.runtime.InteractionAgentRuntime", self.runtime()):
            request=self.coordinator.submit("work", task_id="Task")
            outcome=await self.coordinator.wait(request["request_id"])
        self.assertEqual(outcome["status"], "failed")
        self.assertEqual(outcome["runs"][0]["status"], "failed")

    async def test_finalizer_failure_and_empty_reply_are_visible(self):
        async def execute(name, instructions, **kwargs): return ExecutionResult(name, True, "done")
        for runtime in (self.runtime(failed=True), self.runtime(no_reply=True)):
            with patch.object(tools._EXECUTION_BATCH_MANAGER, "execute_agent", side_effect=execute), patch("server.agents.interaction_agent.runtime.InteractionAgentRuntime", runtime):
                request=self.coordinator.submit("work", task_id="Task")
                outcome=await self.coordinator.wait(request["request_id"])
            self.assertEqual(outcome["status"], "failed")
            self.assertTrue(outcome["error"])

    async def test_shutdown_cancels_owned_workers(self):
        started=asyncio.Event()
        async def execute(name,instructions,**kwargs):
            self.coordinator.begin_completion()
            self.coordinator.stream_content("Unfinished worker output")
            started.set()
            await asyncio.Event().wait()
        with patch.object(tools._EXECUTION_BATCH_MANAGER,"execute_agent",side_effect=execute):
            request=self.coordinator.submit("work",task_id="Task")
            await started.wait()
            await self.coordinator.shutdown()
        outcome=self.store.get(request["request_id"])
        self.assertEqual(outcome["status"],"interrupted")
        self.assertEqual(outcome["runs"][0]["status"],"interrupted")
        self.assertIsNone(outcome["runs"][0]["partial_response"])

    async def test_phase_sealing_collects_fast_workers_and_bounded_extra_phase(self):
        coordinator=self.coordinator
        manager=tools._EXECUTION_BATCH_MANAGER
        log=self.log
        class Runtime:
            async def execute(self,text):
                coordinator.register_worker("A","fast",manager)
                await asyncio.sleep(0)
                coordinator.register_worker("B","slow",manager)
                return InteractionResult(True,"",execution_agents_used=2)
            async def handle_agent_message(self,text):
                log.record_reply(text)
                return InteractionResult(True,text)
        async def worker(name,instructions,**kwargs): return ExecutionResult(name,True,instructions)
        with patch.object(manager,"execute_agent",side_effect=worker),patch("server.agents.interaction_agent.runtime.InteractionAgentRuntime",Runtime):
            request=coordinator.submit("route")
            outcome=await coordinator.wait(request["request_id"])
        self.assertEqual(outcome["status"],"succeeded")
        self.assertEqual(len(outcome["runs"]),2)
        self.assertEqual(len(self.messages),1)
        self.assertIn("A:",self.messages[0][2])
        self.assertIn("B:",self.messages[0][2])
        self.assertIsNone(self.messages[0][1])

    async def test_routing_failure_is_terminal(self):
        class Runtime:
            async def execute(self,text): return InteractionResult(False,"",error="Routing unavailable")
        with patch("server.agents.interaction_agent.runtime.InteractionAgentRuntime",Runtime):
            request=self.coordinator.submit("route")
            outcome=await self.coordinator.wait(request["request_id"])
        self.assertEqual(outcome["status"],"failed")
        self.assertEqual(outcome["error"],"Routing unavailable")

    async def test_additional_phase_limit_cancels_newly_registered_work(self):
        coordinator=self.coordinator
        manager=tools._EXECUTION_BATCH_MANAGER
        log=self.log
        class Runtime:
            async def handle_agent_message(self,text):
                log.record_reply(text)
                coordinator.register_worker("Again","more",manager)
                return InteractionResult(True,text)
        async def worker(name,instructions,**kwargs): return ExecutionResult(name,True,"done")
        with patch.object(manager,"execute_agent",side_effect=worker),patch("server.agents.interaction_agent.runtime.InteractionAgentRuntime",Runtime):
            request=coordinator.submit("work",task_id="Task")
            outcome=await coordinator.wait(request["request_id"])
        self.assertEqual(outcome["status"],"failed")
        self.assertIn("phase limit",outcome["error"])
        self.assertFalse(any(run["status"] in {"queued","running"} for run in outcome["runs"]))

    async def test_collision_and_stale_target_reject_before_acceptance(self):
        with patch("server.services.execution.request_coordinator.get_task_directory",return_value=SimpleNamespace(resolve=lambda x: "Ambiguous",has_collision=lambda x: True)):
            with self.assertRaises(ValueError): self.coordinator.submit("work",task_id="id")
        def missing(identifier): raise KeyError(identifier)
        with patch("server.services.execution.request_coordinator.get_task_directory",return_value=SimpleNamespace(resolve=missing)):
            with self.assertRaises(KeyError): self.coordinator.submit("work",task_id="gone")

    async def test_progress_ack_does_not_mask_missing_final_reply(self):
        coordinator=self.coordinator
        log=self.log
        class Runtime:
            async def execute(self,text):
                log.record_reply("Working on it")
                coordinator.register_worker("Task",text,tools._EXECUTION_BATCH_MANAGER)
                return InteractionResult(True,"Working on it")
            async def handle_agent_message(self,text): return InteractionResult(True,"")
        async def worker(name,instructions,**kwargs): return ExecutionResult(name,True,"Done")
        with patch.object(tools._EXECUTION_BATCH_MANAGER,"execute_agent",side_effect=worker),patch("server.agents.interaction_agent.runtime.InteractionAgentRuntime",Runtime):
            request=coordinator.submit("work")
            outcome=await coordinator.wait(request["request_id"])
        self.assertEqual(outcome["status"],"failed")
        self.assertIn("final user-facing",outcome["error"])

    async def test_shared_gate_cancellation_cleanup_does_not_bypass_order(self):
        from ..agents.execution_agent.batch_manager import task_gate, _TASK_LOCKS
        entered=asyncio.Event()
        release=asyncio.Event()
        order=[]
        async def item(value):
            async with task_gate("Cleanup"):
                order.append(value)
                if value == 1:
                    entered.set()
                    await release.wait()
        first=asyncio.create_task(item(1))
        await entered.wait()
        canceled=asyncio.create_task(item(2))
        third=asyncio.create_task(item(3))
        await asyncio.sleep(0)
        canceled.cancel()
        await asyncio.gather(canceled,return_exceptions=True)
        fourth=asyncio.create_task(item(4))
        await asyncio.sleep(0)
        self.assertEqual(order,[1])
        release.set()
        await asyncio.gather(first,third,fourth)
        self.assertEqual(order,[1,3,4])
        self.assertNotIn("Cleanup",_TASK_LOCKS)

    async def test_schedule_interrupted_occurrence_is_held_after_reopen(self):
        from ..services.trigger_scheduler import TriggerScheduler
        trigger=SimpleNamespace(id=5,agent_name="ScheduleTask",next_trigger="2026-01-01T10:00:00Z",payload="offline",recurrence_rule=None,timezone=None,start_time=None)
        service=SimpleNamespace(record_failure=lambda *args: None,get_due_triggers=lambda **kwargs:[trigger])
        started=asyncio.Event()
        async def worker(name,instructions,**kwargs):
            started.set()
            await asyncio.Event().wait()
        with patch("server.services.trigger_scheduler.get_trigger_service",return_value=service),patch("server.services.execution.request_coordinator.get_request_coordinator",return_value=self.coordinator),patch.object(tools._EXECUTION_BATCH_MANAGER,"execute_agent",side_effect=worker) as execute:
            scheduler=TriggerScheduler()
            wrapper=asyncio.create_task(scheduler._execute_trigger(trigger))
            await started.wait()
            wrapper.cancel()
            await asyncio.gather(wrapper,return_exceptions=True)
            await self.coordinator.shutdown()
            self.store.close()
            self.store=RequestStore(Path(self.folder.name)/"requests.db")
            self.coordinator=RequestCoordinator(self.store)
            self.coordinator.start()
            with patch("server.services.execution.request_coordinator.get_request_coordinator",return_value=self.coordinator):
                reopened=TriggerScheduler()
                await reopened._execute_trigger(trigger)
                await reopened._execute_trigger(trigger)
            await reopened._poll_once()
            self.assertFalse(reopened._executions)
            self.assertEqual(execute.call_count,1)
            self.assertIn((5,"ScheduleTask",trigger.next_trigger),reopened._held_occurrences)
        self.assertEqual(trigger.next_trigger,"2026-01-01T10:00:00Z")

    async def test_clear_rejects_active_then_removes_sidecar_and_legacy(self):
        from ..routes.chat import clear_history
        from fastapi import HTTPException
        from unittest.mock import Mock
        mocks=[Mock(),Mock(),Mock(),Mock()]
        scheduler=SimpleNamespace(_in_flight=set())
        with patch("server.services.execution.request_coordinator.get_request_coordinator",return_value=self.coordinator),patch("server.services.trigger_scheduler.get_trigger_scheduler",return_value=scheduler),patch("server.routes.chat.get_conversation_log",return_value=mocks[0]),patch("server.services.get_execution_agent_logs",return_value=mocks[1]),patch("server.services.get_agent_roster",return_value=mocks[2]),patch("server.routes.chat.get_trigger_service",return_value=mocks[3]):
            scheduler._in_flight.add(1)
            with self.assertRaises(HTTPException) as rejection: await clear_history()
            self.assertEqual(rejection.exception.status_code,409)
            mocks[0].clear.assert_not_called()
            scheduler._in_flight.clear()
            with patch.object(self.coordinator,"has_active_work",return_value=True):
                with self.assertRaises(HTTPException): await clear_history()
            request,_=self.store.create("Private text",submission_id="receipt")
            self.store.add_run(request["request_id"],"private-task-id","Private task name")
            self.store.update(request["request_id"],status="succeeded")
            await clear_history()
            self.assertIsNone(self.store.get(request["request_id"]))
            for index,method in ((0,"clear"),(1,"clear_all"),(2,"clear"),(3,"clear_all")):
                getattr(mocks[index],method).assert_called_once()
            with self.assertRaises(SubmissionConflict): self.store.create("Private text",submission_id="receipt")
            rows=self.store._db.execute("SELECT fingerprint FROM cleared_submissions").fetchall()
            self.assertNotIn("Private",str(rows))

    async def test_http_submission_status_validation_and_retry_contract(self):
        import httpx
        import uuid
        from ..app import app
        async def execute(name,instructions,**kwargs):
            kwargs["on_start"]()
            return ExecutionResult(name,True,"Done")
        target="a"*64
        submission=str(uuid.uuid4())
        payload={"messages":[{"role":"user","content":"Same text"}],"task_id":target,"submission_id":submission}
        with patch("server.services.conversation.chat_handler.InteractionAgentRuntime",return_value=None),patch("server.services.conversation.chat_handler.get_request_coordinator",return_value=self.coordinator),patch("server.services.execution.request_coordinator.get_request_coordinator",return_value=self.coordinator),patch.object(tools._EXECUTION_BATCH_MANAGER,"execute_agent",side_effect=execute),patch("server.agents.interaction_agent.runtime.InteractionAgentRuntime",self.runtime()):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url="http://offline") as client:
                response=await client.post("/api/v1/chat/send",json=payload)
                self.assertEqual(response.status_code,202)
                receipt=response.json()
                self.assertEqual(set(receipt),{"request_id","status","task_id"})
                self.assertEqual(receipt["task_id"],target)
                await self.coordinator.wait(receipt["request_id"])
                repeated=await client.post("/api/v1/chat/send",json=payload)
                self.assertEqual(repeated.json()["request_id"],receipt["request_id"])
                changed={**payload,"messages":[{"role":"user","content":"Changed"}]}
                self.assertEqual((await client.post("/api/v1/chat/send",json=changed)).status_code,409)
                status=(await client.get("/api/v1/chat/requests/"+receipt["request_id"])).json()
                self.assertEqual(status["status"],"succeeded")
                self.assertEqual(status["runs"][0]["status"],"succeeded")
                self.assertEqual(set(status),{"request_id","status","task_id","origin","error","created_at","updated_at","runs","partial_response"})
                self.assertEqual((await client.get("/api/v1/chat/requests/missing")).status_code,404)
                self.assertEqual((await client.post("/api/v1/chat/send",json={**payload,"task_id":"bad"})).status_code,422)
                self.assertEqual((await client.post("/api/v1/chat/send",json={"messages":[]})).status_code,400)

class WorkerFailureTests(unittest.IsolatedAsyncioTestCase):
    async def test_failed_tool_followed_by_successful_prose_remains_failed(self):
        with tempfile.TemporaryDirectory() as folder:
            logs=ExecutionAgentLogStore(Path(folder)/"logs")
            with patch("server.agents.execution_agent.agent.get_execution_agent_logs",return_value=logs),patch("server.agents.execution_agent.runtime.get_settings",return_value=SimpleNamespace(openrouter_api_key="offline",execution_agent_model="fake")):
                runtime=ExecutionAgentRuntime("Fake")
            responses=[{"choices":[{"message":{"tool_calls":[{"id":"tool1","function":{"name":"fake","arguments":"{}"}}]}}]}, {"choices":[{"message":{"content":"Everything completed"}}]}]
            from unittest.mock import AsyncMock
            with patch.object(runtime,"_make_llm_call",side_effect=responses),patch.object(runtime,"_execute_tool",new=AsyncMock(return_value=(False,{"error":"Denied"}))):
                result=await runtime.execute("offline")
            self.assertFalse(result.success)
            self.assertIn("Denied",result.error)

    async def test_returned_tool_error_is_not_success_and_bad_arguments_are_not_replaced(self):
        with tempfile.TemporaryDirectory() as folder:
            logs=ExecutionAgentLogStore(Path(folder)/"logs")
            with patch("server.agents.execution_agent.agent.get_execution_agent_logs",return_value=logs),patch("server.agents.execution_agent.runtime.get_settings",return_value=SimpleNamespace(openrouter_api_key="offline",execution_agent_model="fake")):
                runtime=ExecutionAgentRuntime("Fake")
            runtime.tool_registry={"fixture":lambda:{"error":"Fixture refusal"}}
            success,result=await runtime._execute_tool("fixture",{})
            self.assertFalse(success)
            self.assertEqual(result["error"],"Fixture refusal")
            for arguments in ('{"broken":','[]'):
                with self.assertRaises(RuntimeError):
                    runtime._extract_tool_calls([{"function":{"name":"fixture","arguments":arguments}}])

class ConversationMetadataTests(unittest.TestCase):
    def test_old_log_unchanged_and_new_draft_has_stable_correlation(self):
        from ..services.conversation.log import ConversationLog
        from ..services.execution.request_context import RequestContext
        from unittest.mock import Mock
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/"conversation.log"
            old='<user_message timestamp="old">Original</user_message>\n'
            path.write_text(old)
            with patch("server.services.conversation.log._resolve_working_memory_log",return_value=Mock()):
                log=ConversationLog(path)
                with patch.object(log,"_notify_summarization"):
                    token=current_request.set(RequestContext(None,"request123","task123"))
                    try:
                        result=tools.send_draft
                        with patch.object(tools,"get_conversation_log",return_value=log):
                            result=tools.send_draft("fictional@example.test","Subject","Body")
                        self.assertIsNotNone(result.user_message)
                        self.assertEqual(current_request.get().replies,1)
                    finally: current_request.reset(token)
            self.assertTrue(path.read_text().startswith(old))
            messages=log.to_chat_messages()
            self.assertIsNone(messages[0].id)
            self.assertEqual(messages[1].role,"draft")
            self.assertEqual(messages[1].request_id,"request123")
            self.assertEqual(messages[1].task_id,"task123")
            self.assertEqual(log.to_chat_messages()[1].id,messages[1].id)
