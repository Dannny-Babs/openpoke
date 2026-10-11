"""Real SSE parser and transport exercised exclusively through in-memory HTTP fixtures."""
import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import httpx
from ..openrouter_client import client as provider
from ..services.execution.request_context import RequestContext,current_request
from ..services.execution.request_store import RequestStore
from ..services.execution.request_coordinator import RequestCoordinator

def event(value):
    return "data: " + json.dumps(value) + "\n\n"

def chunk(content=None, tools=None, finish=None, reasoning=None):
    delta={}
    if content is not None: delta["content"]=content
    if tools is not None: delta["tool_calls"]=tools
    if reasoning is not None: delta["reasoning"]=reasoning
    return {"choices":[{"index":0,"delta":delta,"finish_reason":finish}]}

class Pieces(httpx.AsyncByteStream):
    def __init__(self,body): self.body=body.encode()
    async def __aiter__(self):
        for index in range(0,len(self.body),7):
            await asyncio.sleep(0)
            yield self.body[index:index+7]

class ProviderStreamTests(unittest.IsolatedAsyncioTestCase):
    async def completion(self,body,status=200,on_content=None):
        requests=[]
        def handle(request):
            requests.append(json.loads(request.content))
            if status != 200:
                return httpx.Response(status,json={"error":{"message":"Fixture denial"}})
            return httpx.Response(200,headers={"content-type":"text/event-stream"},stream=Pieces(body))
        client=httpx.AsyncClient(transport=httpx.MockTransport(handle))
        with patch.object(provider.httpx,"AsyncClient",return_value=client),patch.object(provider,"_headers",return_value={}):
            result=await provider.request_chat_completion(model="fixture",messages=[],on_content=on_content)
        self.assertTrue(requests[0]["stream"])
        return result

    async def test_network_fragmentation_comments_reasoning_and_done(self):
        seen=[]
        body=": provider keepalive\n\n"+event(chunk(content="Hello ",reasoning="PRIVATE THINKING"))+event(chunk(content="世界"))+event(chunk(finish="stop"))+"data: [DONE]\n\n"
        result=await self.completion(body,on_content=seen.append)
        self.assertEqual(result["choices"][0]["message"]["content"],"Hello 世界")
        self.assertEqual(seen,["Hello ","世界"])
        self.assertNotIn("PRIVATE",str(result)+str(seen))

    async def test_fragmented_parallel_tool_arguments_are_reassembled_not_published(self):
        seen=[]
        first=[{"index":1,"id":"callB","function":{"name":"sec","arguments":"{\"secret\":"}},{"index":0,"id":"callA","function":{"name":"fir","arguments":"{\"id\":"}}]
        second=[{"index":0,"function":{"name":"st","arguments":"1}"}},{"index":1,"function":{"name":"ond","arguments":"\"PRIVATE\"}"}}]
        body=event(chunk(tools=first))+event(chunk(tools=second))+event(chunk(finish="tool_calls"))+"data: [DONE]\n\n"
        result=await self.completion(body,on_content=seen.append)
        calls=result["choices"][0]["message"]["tool_calls"]
        self.assertEqual([call["function"]["name"] for call in calls],["first","second"])
        self.assertEqual(json.loads(calls[1]["function"]["arguments"]),{"secret":"PRIVATE"})
        self.assertEqual(seen,[])

    async def test_done_usage_and_multiline_event(self):
        body='data: {"choices":\ndata: [{"index":0,"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\n'+event({"choices":[],"usage":{"total_tokens":9}})+"data: [DONE]\n\n"
        result=await self.completion(body)
        self.assertEqual(result["usage"]["total_tokens"],9)

    async def test_error_truncation_malformed_and_length_never_become_results(self):
        invalid=[event({"error":{"message":"Fixture error"}}),event(chunk(content="partial")),event(chunk(content="partial",finish="stop")),"data: {invalid}\n\n", "data: [DONE]\n\n",event(chunk(content="cut",finish="length"))+"data: [DONE]\n\n"]
        for body in invalid:
            with self.subTest(body=body):
                with self.assertRaises(provider.OpenRouterError): await self.completion(body)

    async def test_done_cannot_make_truncated_or_nonobject_tool_arguments_executable(self):
        for arguments in ('{"secret":', '[]'):
            body=event(chunk(tools=[{"index":0,"id":"id","function":{"name":"fixture","arguments":arguments}}]))+event(chunk(finish="tool_calls"))+"data: [DONE]\n\n"
            with self.assertRaises(provider.OpenRouterError): await self.completion(body)

    async def test_choice_error_preserves_only_code_and_message(self):
        value=chunk(finish="error")
        value["choices"][0]["error"]={"code":429,"message":"Fixture quota limit","metadata":{"request":"PRIVATE REQUEST","headers":"PRIVATE AUTH"}}
        with self.assertRaises(provider.OpenRouterError) as error:
            await self.completion(event(value))
        self.assertIn("429",str(error.exception))
        self.assertIn("Fixture quota limit",str(error.exception))
        self.assertNotIn("PRIVATE",str(error.exception))

    async def test_http_error(self):
        with self.assertRaises(provider.OpenRouterError) as error:
            await self.completion("",status=401)
        self.assertIn("401",str(error.exception))

class PartialIsolationTests(unittest.TestCase):
    def test_run_owned_bounded_throttled_partials_and_terminal_cleanup(self):
        with tempfile.TemporaryDirectory() as folder:
            store=RequestStore(Path(folder)/"requests.db")
            coordinator=RequestCoordinator(store)
            a,_=store.create("first")
            b,_=store.create("second")
            run_a=store.add_run(a["request_id"],"taskA","A")
            run_b=store.add_run(b["request_id"],"taskB","B")
            context=RequestContext(coordinator,a["request_id"],"taskA",run_id=run_a["id"])
            token=current_request.set(context)
            try:
                coordinator.begin_completion()
                with patch("server.services.execution.request_coordinator.time.monotonic",side_effect=[1.0,1.1,1.4]):
                    coordinator.stream_content("Hello")
                    coordinator.stream_content(" hiddenuntilnextflush")
                    self.assertEqual(store.get(a["request_id"])["runs"][0]["partial_response"],"Hello")
                    coordinator.stream_content("界"*9000)
                displayed=store.get(a["request_id"])["runs"][0]["partial_response"]
                self.assertLessEqual(len(displayed.encode()),8192)
                self.assertIsNone(store.get(b["request_id"])["runs"][0]["partial_response"])
                self.assertIsNone(store.get(a["request_id"])["partial_response"])
                coordinator.tool_activity("fixture_tool","running")
                active=store.get(a["request_id"])["runs"][0]
                self.assertEqual(active["activity"],{"name":"fixture_tool","status":"running"})
                self.assertIsNone(active["partial_response"])
                coordinator.begin_completion()
                self.assertIsNone(store.get(a["request_id"])["runs"][0]["activity"])
                coordinator.stream_content("New iteration")
                store.update_run(a["request_id"],run_a["id"],status="failed",error="Tool failed")
                ended=store.get(a["request_id"])["runs"][0]
                self.assertIsNone(ended["partial_response"])
                self.assertIsNone(ended["activity"])
            finally: current_request.reset(token)
            # Routing/finalizer contexts do not publish their ordinary planning text.
            token=current_request.set(RequestContext(coordinator,b["request_id"]))
            try: coordinator.stream_content("PRIVATE ROUTING")
            finally: current_request.reset(token)
            self.assertIsNone(store.get(b["request_id"])["partial_response"])
            store.close()
