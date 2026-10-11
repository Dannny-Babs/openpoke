"""HTTP-to-runtime mechanics with scripted provider fixtures, never semantic/model QA."""
import asyncio
import json
import tempfile
import unittest
import uuid
from contextlib import ExitStack
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch
import httpx
from ..app import app
from ..services.execution.roster import AgentRoster
from ..services.execution.log_store import ExecutionAgentLogStore
from ..services.execution.directory import TaskDirectory, task_id, get_task_directory
from ..services.execution.request_store import RequestStore
from ..services.execution.request_coordinator import RequestCoordinator
from ..services.conversation.log import ConversationLog
from ..openrouter_client import OpenRouterError


def completion(content="",calls=None):
    message={"role":"assistant","content":content}
    if calls:
        message["tool_calls"]=[{"id":f"fixture-{index}","type":"function","function":{"name":name,"arguments":json.dumps(arguments)}} for index,(name,arguments) in enumerate(calls)]
    return {"choices":[{"message":message}]}

class HTTPBoundaryTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.folder=tempfile.TemporaryDirectory()
        self.root=Path(self.folder.name)
        self.stack=ExitStack()
        self.settings=SimpleNamespace(openrouter_api_key="offline-fixture",interaction_agent_model="fixture-router",execution_agent_model="fixture-worker",summarization_enabled=False)
        self.roster=AgentRoster(self.root/"roster.json")
        self.logs=ExecutionAgentLogStore(self.root/"workers")
        self.directory=TaskDirectory(self.roster,self.logs)
        self.store=RequestStore(self.root/"requests.db")
        self.coordinator=RequestCoordinator(self.store)
        self.stack.enter_context(patch("server.services.conversation.log._resolve_working_memory_log",return_value=Mock()))
        self.log=ConversationLog(self.root/"conversation.log")
        self.routing_plan={}
        self.started={}
        self.release={}
        self.worker_calls=[]
        self.worker_prompts=[]
        targets={
            "server.agents.interaction_agent.runtime.get_settings":self.settings,
            "server.agents.execution_agent.runtime.get_settings":self.settings,
            "server.services.conversation.log.get_settings":self.settings,
            "server.agents.interaction_agent.runtime.get_conversation_log":self.log,
            "server.agents.interaction_agent.tools.get_conversation_log":self.log,
            "server.routes.chat.get_conversation_log":self.log,
            "server.services.conversation.get_conversation_log":self.log,
            "server.agents.interaction_agent.runtime.get_working_memory_log":Mock(),
            "server.agents.interaction_agent.tools.get_agent_roster":self.roster,
            "server.agents.interaction_agent.tools.get_task_directory":self.directory,
            "server.agents.interaction_agent.agent.get_task_directory":self.directory,
            "server.agents.execution_agent.batch_manager.get_task_directory":self.directory,
            "server.agents.execution_agent.batch_manager.get_execution_agent_logs":self.logs,
            "server.agents.execution_agent.agent.get_execution_agent_logs":self.logs,
            "server.services.execution.request_coordinator.get_task_directory":self.directory,
            "server.services.conversation.chat_handler.get_request_coordinator":self.coordinator,
            "server.services.execution.request_coordinator.get_request_coordinator":self.coordinator,
            "server.agents.execution_agent.runtime.get_tool_schemas":[],
            "server.agents.execution_agent.runtime.get_tool_registry":{},
        }
        for name,value in targets.items():self.stack.enter_context(patch(name,return_value=value))
        self.stack.enter_context(patch("server.agents.interaction_agent.runtime.request_chat_completion",side_effect=self.router_fixture))
        self.stack.enter_context(patch("server.agents.execution_agent.runtime.request_chat_completion",side_effect=self.worker_fixture))
        # Any unintended provider/integration transport is rejected, including sync tools.
        self.stack.enter_context(patch("httpx.AsyncHTTPTransport.handle_async_request",side_effect=AssertionError("External HTTP forbidden in boundary tests")))
        self.stack.enter_context(patch("httpx.HTTPTransport.handle_request",side_effect=AssertionError("External HTTP forbidden in boundary tests")))
        self.previous_overrides=app.dependency_overrides.copy()
        app.dependency_overrides[get_task_directory]=lambda:self.directory
        self.client=httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url="http://fixture")

    async def asyncTearDown(self):
        await self.coordinator.shutdown()
        await self.client.aclose()
        app.dependency_overrides.clear()
        app.dependency_overrides.update(self.previous_overrides)
        self.stack.close()
        self.store.close()
        self.folder.cleanup()

    async def router_fixture(self,**kwargs):
        messages=kwargs["messages"]
        if messages[-1].get("role")=="tool":return completion()
        text=messages[-1]["content"]
        if "<new_agent_message>" in text:
            outcome=text.rsplit("<new_agent_message>",1)[1].split("</new_agent_message>",1)[0].strip()
            return completion(calls=[("send_message_to_user",{"message":outcome})])
        text=text.rsplit("<new_user_message>",1)[1].split("</new_user_message>",1)[0].strip()
        name=self.routing_plan[text]
        return completion(calls=[("send_message_to_user",{"message":"Working on this request"}),("send_message_to_agent",{"agent_name":name,"instructions":text})])

    async def worker_fixture(self,**kwargs):
        text=kwargs["messages"][0]["content"]
        self.worker_calls.append(text)
        self.worker_prompts.append((text,kwargs["system"]))
        if text=="fail-worker":raise OpenRouterError("Fixture worker unavailable")
        if kwargs.get("on_content"):kwargs["on_content"]("RESULT " + text)
        if text in self.started:
            self.started[text].set()
            await self.release[text].wait()
        return completion("RESULT "+text)

    async def post(self,text,task=None,submission=None):
        body={"messages":[{"role":"user","content":text}]}
        if task:body["task_id"]=task
        if submission:body["submission_id"]=submission
        return await self.client.post("/api/v1/chat/send",json=body)

    async def finish(self,response):
        self.assertEqual(response.status_code,202,response.text)
        receipt=response.json()
        await self.coordinator.wait(receipt["request_id"])
        status=await self.client.get("/api/v1/chat/requests/"+receipt["request_id"])
        self.assertEqual(status.status_code,200)
        return status.json()

    async def test_older_lookup_continuation_then_new_independent_task(self):
        older="Archive lighthouse research"
        self.roster.add_agent(older)
        self.logs.record_agent_response(older,"Fictional saved evidence")
        for index in range(80):
            name=f"Recent unrelated task {index:03d}"
            self.roster.add_agent(name)
            self.logs.record_agent_response(name,"Fictional recent result")
        shortlist=self.directory.context("")["tasks"]
        self.assertNotIn(task_id(older),[row["id"] for row in shortlist])
        found=await self.client.get("/api/v1/tasks",params={"q":"lighthouse"})
        self.assertEqual(found.status_code,200)
        identifier=found.json()["tasks"][0]["id"]
        history=await self.client.get(f"/api/v1/tasks/{identifier}/history")
        self.assertIn("Fictional saved evidence",history.text)
        continued=await self.finish(await self.post("continue-old",identifier))
        self.assertEqual(continued["status"],"succeeded")
        self.assertEqual(continued["runs"][0]["task_name"],older)
        self.assertIn("Fictional saved evidence",self.worker_prompts[0][1])
        self.routing_plan["independent-new"]="Independent reading task"
        independent=await self.finish(await self.post("independent-new"))
        self.assertEqual(independent["status"],"succeeded")
        self.assertEqual(independent["runs"][0]["task_name"],"Independent reading task")
        self.assertNotEqual(independent["request_id"],continued["request_id"])
        self.assertNotIn("continue-old",self.worker_prompts[1][1])
        messages=(await self.client.get("/api/v1/chat/history")).json()["messages"]
        replies=[message for message in messages if message["role"]=="assistant" and message["content"].startswith("[SUCCESS]")]
        self.assertEqual([message["task_id"] for message in replies],[identifier,task_id("Independent reading task")])

    async def test_overlapping_http_requests_have_separate_partials_results_and_errors(self):
        for name in ("Task A","Task B"):self.roster.add_agent(name)
        self.started["held-A"]=asyncio.Event()
        self.release["held-A"]=asyncio.Event()
        first=await self.post("held-A",task_id("Task A"))
        await asyncio.wait_for(self.started["held-A"].wait(),2)
        second=await self.finish(await self.post("finish-B",task_id("Task B")))
        running=(await self.client.get("/api/v1/chat/requests/"+first.json()["request_id"])).json()
        self.assertEqual(running["status"],"running")
        self.assertEqual(running["runs"][0]["partial_response"],"RESULT held-A")
        self.assertEqual(second["runs"][0]["response"],"RESULT finish-B")
        self.assertIsNone(second["runs"][0]["partial_response"])
        self.assertNotIn("held-A",json.dumps(second))
        self.release["held-A"].set()
        completed=await self.finish(first)
        self.assertEqual(completed["runs"][0]["response"],"RESULT held-A")
        self.assertNotIn("finish-B",json.dumps(completed))
        failed=await self.finish(await self.post("fail-worker",task_id("Task A")))
        self.assertEqual(failed["status"],"failed")
        self.assertEqual(failed["runs"][0]["status"],"failed")
        self.assertIn("Fixture worker unavailable",failed["runs"][0]["error"])
        self.assertIsNone(failed["runs"][0]["partial_response"])

    async def test_repeated_input_new_ids_execute_but_transport_retry_does_not(self):
        self.roster.add_agent("Repeat task")
        target=task_id("Repeat task")
        receipt=str(uuid.uuid4())
        first=await self.finish(await self.post("same-text",target,receipt))
        retried=await self.finish(await self.post("same-text",target,receipt))
        second=await self.finish(await self.post("same-text",target,str(uuid.uuid4())))
        self.assertEqual(first["request_id"],retried["request_id"])
        self.assertNotEqual(first["request_id"],second["request_id"])
        self.assertEqual(self.worker_calls,["same-text","same-text"])
        conflict=await self.post("changed-text",target,receipt)
        self.assertEqual(conflict.status_code,409)
        messages=(await self.client.get("/api/v1/chat/history")).json()["messages"]
        submitted=[message for message in messages if message["role"]=="user"]
        self.assertEqual(len(submitted),2)
        self.assertEqual(len({message["request_id"] for message in submitted}),2)
        self.assertEqual(len({message["id"] for message in submitted}),2)

    async def test_configuration_and_target_rejections_never_dispatch_work(self):
        self.roster.add_agent("Collision A")
        self.roster.add_agent("Collision-A")
        ambiguous=await self.post("not accepted",task_id("Collision A"))
        self.assertEqual(ambiguous.status_code,400)
        missing=await self.post("not accepted","f"*64)
        self.assertEqual(missing.status_code,404)
        disabled=SimpleNamespace(**{**self.settings.__dict__,"openrouter_api_key":""})
        with patch("server.agents.interaction_agent.runtime.get_settings",return_value=disabled):
            unavailable=await self.post("not accepted")
        self.assertEqual(unavailable.status_code,400)
        self.assertEqual(self.worker_calls,[])
        self.assertFalse(self.coordinator.has_active_work())
        self.assertEqual(self.store._db.execute("SELECT COUNT(*) FROM requests").fetchone()[0],0)
