import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from server.agents.interaction_agent import agent, tools
from server.agents.execution_agent.runtime import ExecutionResult
from server.services.execution.request_context import RequestContext, current_request
from server.services.execution.request_coordinator import RequestCoordinator
from server.services.execution.request_store import RequestStore
from server.routes.tasks import router
from server.services.execution.directory import (
    AmbiguousHistory, CONTEXT_BYTES, DirectoryChanged, HISTORY_BYTES, SEARCH_BYTES,
    TaskDirectory, encoded_size, get_task_directory, task_id,
)
from server.services.execution.log_store import ExecutionAgentLogStore
from server.services.execution.roster import AgentRoster
from server.services.triggers.service import TriggerService
from server.services.triggers.store import TriggerStore


class DirectoryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.roster = AgentRoster(self.root / "roster.json")
        self.logs = ExecutionAgentLogStore(self.root / "logs")
        self.directory = TaskDirectory(self.roster, self.logs)

    def seed(self, names):
        (self.root / "roster.json").write_text(json.dumps(names))
        self.roster.load()

    def test_context_is_bounded_without_deleting_roster(self):
        for count in (10, 100, 1000):
            with self.subTest(workers=count):
                self.seed([f"Task {i:04d}" for i in range(count)])
                snapshot = self.directory.context("Task 0000")
                self.assertLessEqual(len(snapshot["tasks"]), 8)
                self.assertLessEqual(encoded_size(snapshot), CONTEXT_BYTES)
                self.assertEqual(snapshot["tasks"][0]["id"], task_id("Task 0000"))
                self.assertEqual(len(self.directory.names()), count)

    def test_reopened_stores_find_old_task_and_retain_history(self):
        self.seed(["Email to Alice"] + [f"Recent task {i}" for i in range(100)])
        self.logs.record_agent_response("Email to Alice", "Fictional saved draft")
        reopened = TaskDirectory(AgentRoster(self.root / "roster.json"), ExecutionAgentLogStore(self.root / "logs"))
        found = reopened.page("Alice")["tasks"][0]
        self.assertEqual(found["id"], task_id("Email to Alice"))
        self.assertEqual(reopened.resolve(found["id"]), "Email to Alice")
        self.assertEqual(reopened.history(found["id"])["entries"][0]["content"], "Fictional saved draft")
        self.assertEqual(len(reopened.names()), 101)

    def test_unicode_escaping_and_long_names_respect_bytes(self):
        self.seed([f"{i} " + '界<&"' * 600 for i in range(100)])
        self.assertLessEqual(encoded_size(self.directory.context("界")), CONTEXT_BYTES)
        page = self.directory.page()
        self.assertLessEqual(encoded_size(page), SEARCH_BYTES)
        self.assertTrue(page["tasks"][0]["name_truncated"])
        name = self.directory.resolve(page["tasks"][0]["id"])
        self.assertGreater(len(name), 200)

    def test_older_worker_found_when_absent_from_initial_shortlist(self):
        self.seed(["Email to Alice"] + [f"Recent task {i}" for i in range(1000)])
        self.assertNotIn(task_id("Email to Alice"), [r["id"] for r in self.directory.context("What happened?")["tasks"]])
        result = self.directory.page("Alice")
        self.assertEqual(result["tasks"][0]["id"], task_id("Email to Alice"))

    def test_browsing_pagination_has_no_missing_workers(self):
        self.seed([f"Task {i}" for i in range(53)])
        seen, cursor = [], None
        while True:
            page = self.directory.page(cursor=cursor, limit=7)
            seen.extend(r["id"] for r in page["tasks"])
            self.assertLessEqual(encoded_size(page), SEARCH_BYTES)
            cursor = page["next_cursor"]
            if cursor is None:
                break
        self.assertEqual(len(seen), 53)
        self.assertEqual(len(set(seen)), 53)

    def test_changed_directory_rejects_stale_cursor(self):
        self.seed(["One", "Two", "Three"])
        cursor = self.directory.page(limit=1)["next_cursor"]
        self.seed(["One", "Two", "Three", "Four"])
        with self.assertRaises(DirectoryChanged):
            self.directory.page(cursor=cursor)
        self.assertEqual(self.directory.page()["total"], 4)

    def test_activity_reordering_rejects_cursor(self):
        self.seed(["First", "Second", "Third"])
        cursor = self.directory.page(limit=1)["next_cursor"]
        self.logs.record_request("First", "New sample activity")
        with self.assertRaises(DirectoryChanged):
            self.directory.page(cursor=cursor)
        self.assertEqual(self.directory.page()["tasks"][0]["name"], "First")

    def test_invalid_lookup_and_cursor_cannot_choose_a_path(self):
        self.seed(["Known task"])
        for identifier in ("../../secrets", "bad", "a" * 64):
            with self.subTest(identifier=identifier), self.assertRaises(KeyError):
                self.directory.resolve(identifier)
        for cursor in ("-1", "../../", "1", 2):
            with self.subTest(cursor=cursor), self.assertRaises(ValueError):
                self.directory.page(cursor=cursor)

    def test_names_with_same_slug_have_distinct_keys_but_block_history(self):
        self.seed(["A/B", "A B", "a-b"])
        self.logs.record_request("A/B", "Mixed legacy entry")
        page = self.directory.page()
        self.assertEqual(len({r["id"] for r in page["tasks"]}), 3)
        self.assertTrue(all(r["history_ambiguous"] for r in page["tasks"]))
        for name in self.directory.names():
            with self.assertRaises(AmbiguousHistory):
                self.directory.history(task_id(name))

    def test_latest_history_and_backward_cursor_reach_all_records_without_full_read(self):
        self.seed(["Tail task"])
        for index in range(47):
            self.logs.record_agent_response("Tail task", f"Outcome {index}")
        path = self.logs._log_path("Tail task")
        original = path.read_bytes()
        from unittest.mock import patch
        with patch.object(Path, "read_text", side_effect=AssertionError("Full history read")):
            with self.metadata_client() as client:
                url = f"/api/v1/tasks/{task_id('Tail task')}/history"
                page = client.get(url + "?latest=true&limit=20").json()
                self.assertEqual(page["entries"][-1]["content"], "Outcome 46")
                self.assertEqual(page["start_offset"], 27)
                rows = page["entries"]
                while page["before_offset"] is not None:
                    page = client.get(url + f"?before={page['before_offset']}&limit=20").json()
                    rows = page["entries"] + rows
                self.assertEqual([r["content"] for r in rows], [f"Outcome {i}" for i in range(47)])
                self.assertEqual(client.get(url + "?latest=true&before=20").status_code, 400)
                self.assertEqual(client.get(url + "?latest=true&offset=1").status_code, 400)
                self.assertEqual(client.get(url + "?before=-1").status_code, 422)
        self.assertEqual(path.read_bytes(), original)

    def test_tail_byte_cap_keeps_newest_suffix_and_cursor_does_not_skip(self):
        self.seed(["Large tail"])
        for index in range(25):
            self.logs.record_agent_response("Large tail", f"{index}:" + "界" * 3000)
        before, rows = None, []
        while True:
            page = self.directory.history(task_id("Large tail"), latest=before is None, before=before)
            self.assertLessEqual(encoded_size(page), HISTORY_BYTES)
            self.assertTrue(page["entries"])
            self.assertTrue(all(r["truncated"] for r in page["entries"]))
            rows = page["entries"] + rows
            before = page["before_offset"]
            if before is None:
                break
        self.assertEqual([r["content"].split(":")[0] for r in rows], [str(i) for i in range(25)])
        self.assertEqual(self.directory.history(task_id("Large tail"), before=0)["entries"], [])

    def test_history_pages_preserve_order_and_do_not_change_records(self):
        self.seed(["Picnic"])
        for index in range(27):
            self.logs.record_request("Picnic", f"Request {index}")
        before = self.logs.load_transcript("Picnic")
        result, offset = [], 0
        while True:
            page = self.directory.history(task_id("Picnic"), offset, 6)
            result.extend(r["content"] for r in page["entries"])
            offset = page["next_offset"]
            if offset is None:
                break
        self.assertEqual(result, [f"Request {i}" for i in range(27)])
        self.assertEqual(self.logs.load_transcript("Picnic"), before)

    def test_large_history_entries_have_bounded_display_but_full_record_survives(self):
        self.seed(["Large task"])
        texts = [f"{index:02d}:" + '界<&"' * 3000 for index in range(20)]
        for text in texts:
            self.logs.record_request("Large task", text)
        contents, offset = [], 0
        while True:
            page = self.directory.history(task_id("Large task"), offset)
            self.assertLessEqual(encoded_size(page), HISTORY_BYTES)
            self.assertTrue(all(entry["truncated"] for entry in page["entries"]))
            contents.extend(entry["content"] for entry in page["entries"])
            if page["next_offset"] is None:
                break
            self.assertGreater(page["next_offset"], offset)
            offset = page["next_offset"]
        self.assertEqual(contents, [text[:2000] for text in texts])
        self.assertTrue(list(self.logs.iter_entries("Large task"))[-1][2] == texts[-1], "Full persisted entry was changed")

    def test_empty_directory_and_empty_search_are_distinct(self):
        self.assertEqual(self.directory.page()["total"], 0)
        self.seed(["Picnic"])
        self.assertEqual(self.directory.page("nonexistent")["tasks"], [])
        self.assertEqual(self.directory.page()["total"], 1)

    def test_prompt_uses_same_bound_for_user_and_background_turns(self):
        self.seed([f"Task {i}" for i in range(1000)])
        with patch.object(agent, "get_task_directory", return_value=self.directory):
            for kind in ("user", "agent"):
                prompt = agent.prepare_message_with_history("Task 999", "kept history", kind)[0]["content"]
                block = prompt.split("<task_directory>\n")[1].split("\n</task_directory>")[0]
                self.assertLessEqual(len(block.encode()), CONTEXT_BYTES)
                self.assertIn("kept history", prompt)
                self.assertNotIn("<active_agents>", prompt)

    def test_discovery_does_not_modify_trigger_owner_or_schedule(self):
        self.seed(["Reminders"])
        service = TriggerService(TriggerStore(self.root / "triggers.db"))
        trigger = service.create_trigger(agent_name="Reminders", payload="Fictional reminder", start_time="2030-01-01T12:00:00Z", timezone_name="UTC")
        self.directory.context("reminder")
        self.directory.page("Reminders")
        self.directory.history(task_id("Reminders"))
        reloaded = TriggerStore(self.root / "triggers.db").fetch_one(trigger.id, "Reminders")
        self.assertEqual(reloaded, trigger)

    def metadata_client(self):
        app = FastAPI()
        app.include_router(router, prefix="/api/v1")
        app.dependency_overrides[get_task_directory] = lambda: self.directory
        return TestClient(app)

    def test_exact_metadata_finds_older_task_and_bounds_name_without_history_writes(self):
        older = "Saved old draft " + "🙂" * 400
        recent = [f"Recent fixture {index:02d}" for index in range(40)]
        self.seed([older, *recent])
        self.logs.record_agent_response(older, "Private saved content is not metadata")
        for name in recent:
            self.logs.record_agent_response(name, "Recent fixture output")
        identifier = task_id(older)
        self.assertNotIn(identifier, [row["id"] for row in self.directory.context("")["tasks"]])
        roster_before = (self.root / "roster.json").read_bytes()
        history_before = self.logs._log_path(older).read_bytes()
        with self.metadata_client() as client:
            response = client.get(f"/api/v1/tasks/{identifier}")
        self.assertEqual(response.status_code, 200)
        self.assertLessEqual(len(response.content), 2048)
        self.assertEqual(response.json(), {
            "id": identifier, "name": older[:200], "name_truncated": True,
            "history_ambiguous": False, "last_activity": self.logs.last_activity(older),
        })
        self.assertNotIn("Private saved content", response.text)
        self.assertEqual((self.root / "roster.json").read_bytes(), roster_before)
        self.assertEqual(self.logs._log_path(older).read_bytes(), history_before)

    def test_metadata_invalid_missing_and_non_get_requests_are_rejected(self):
        self.seed(["Exact saved task"])
        before = (self.root / "roster.json").read_bytes()
        with self.metadata_client() as client:
            for identifier in ("not-an-id", "f" * 64, "A" * 64):
                self.assertEqual(client.get(f"/api/v1/tasks/{identifier}").status_code, 404)
            self.assertEqual(client.post(f"/api/v1/tasks/{task_id('Exact saved task')}", json={}).status_code, 405)
        self.assertEqual((self.root / "roster.json").read_bytes(), before)
        self.assertEqual(self.logs.list_agents(), [])

    def test_metadata_reports_collision_without_opening_or_repairing_history(self):
        self.seed(["A/B", "A B"])
        self.logs.record_agent_response("A/B", "Existing mixed legacy record")
        before = self.logs._log_path("A/B").read_bytes()
        with self.metadata_client() as client:
            response = client.get(f"/api/v1/tasks/{task_id('A B')}")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["name"], "A B")
        self.assertTrue(response.json()["history_ambiguous"])
        self.assertNotIn("Existing mixed legacy record", response.text)
        self.assertEqual(self.logs._log_path("A/B").read_bytes(), before)

    def test_read_only_routes_validate_and_reject_ambiguous_history(self):
        app = FastAPI()
        app.include_router(router, prefix="/api/v1")
        app.dependency_overrides[get_task_directory] = lambda: self.directory
        with TestClient(app) as client:
            self.seed(["A/B", "A B", "Picnic"])
            response = client.get("/api/v1/tasks?q=Picnic")
            self.assertEqual(response.status_code, 200)
            self.assertLessEqual(len(response.content), SEARCH_BYTES)
            self.assertEqual(client.get(f"/api/v1/tasks/{task_id('A/B')}/history").status_code, 409)
            self.assertEqual(client.get(f"/api/v1/tasks/{'a'*64}/history").status_code, 404)
            self.assertEqual(client.get("/api/v1/tasks?limit=1000").status_code, 422)
            self.assertEqual(client.post("/api/v1/tasks", json={}).status_code, 405)


class ReuseTests(unittest.IsolatedAsyncioTestCase):
    async def test_exact_id_reuses_old_worker_and_retains_history(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            roster = AgentRoster(root / "roster.json")
            roster.add_agent("Email to Alice")
            logs = ExecutionAgentLogStore(root / "logs")
            logs.record_agent_response("Email to Alice", "Fictional previous result")
            directory = TaskDirectory(roster, logs)
            done = asyncio.Event()
            async def execute(name, instructions, request_id=None, on_start=None):
                if on_start: on_start()
                self.assertEqual(name, "Email to Alice")
                self.assertIn("Fictional previous result", logs.load_transcript(name))
                done.set()
                return ExecutionResult(name, True, "Fictional updated result")
            store = RequestStore(root / "requests.db")
            self.addCleanup(store.close)
            coordinator = RequestCoordinator(store)
            request, _ = store.create("Fictional follow-up")
            context = RequestContext(coordinator, request["request_id"])
            token = current_request.set(context)
            self.addCleanup(current_request.reset, token)
            with patch.object(tools, "get_task_directory", return_value=directory), \
                 patch.object(tools, "get_agent_roster", return_value=roster), \
                 patch.object(tools, "get_execution_agent_logs", return_value=logs), \
                 patch.object(tools._EXECUTION_BATCH_MANAGER, "execute_agent", side_effect=execute):
                found = tools.handle_tool_call("search_execution_agents", {"query": "Alice"})
                identifier = found.payload["tasks"][0]["id"]
                result = tools.handle_tool_call("send_message_to_existing_agent", {"task_id": identifier, "instructions": "Fictional follow-up"})
                self.assertTrue(result.success)
                self.assertFalse(result.payload["new_agent_created"])
                await asyncio.gather(*context.pending)
                await asyncio.wait_for(done.wait(), 2)
                self.assertEqual(roster.get_agents(), ["Email to Alice"])
                roster.clear()
                missing = tools.send_message_to_existing_agent(identifier, "Another follow-up")
                self.assertFalse(missing.success)
                self.assertEqual(roster.get_agents(), [])

    async def test_ambiguous_existing_id_is_rejected_without_submission(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            roster = AgentRoster(root / "roster.json")
            roster.add_agent("A/B")
            roster.add_agent("A B")
            logs = ExecutionAgentLogStore(root / "logs")
            directory = TaskDirectory(roster, logs)
            with patch.object(tools, "get_task_directory", return_value=directory), \
                 patch.object(tools._EXECUTION_BATCH_MANAGER, "execute_agent", new_callable=AsyncMock) as execute:
                result = tools.send_message_to_existing_agent(task_id("A/B"), "Do not mix")
            self.assertFalse(result.success)
            execute.assert_not_called()
            self.assertEqual(logs.list_agents(), [])

    async def test_colliding_name_is_rejected_before_history_write(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            roster = AgentRoster(root / "roster.json")
            roster.add_agent("A/B")
            logs = ExecutionAgentLogStore(root / "logs")
            directory = TaskDirectory(roster, logs)
            with patch.object(tools, "get_task_directory", return_value=directory):
                result = tools.send_message_to_agent("A B", "Must not mix history")
            self.assertFalse(result.success)
            self.assertEqual(logs.list_agents(), [])
            self.assertEqual(roster.get_agents(), ["A/B"])


if __name__ == "__main__":
    unittest.main()
