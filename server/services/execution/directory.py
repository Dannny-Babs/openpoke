"""Bounded views of the full, persistent worker roster. No history migration."""

from __future__ import annotations

import hashlib
import json
import re
from collections import Counter
from typing import Any, Optional

from .log_store import ExecutionAgentLogStore, _slugify, get_execution_agent_logs
from .roster import AgentRoster, get_agent_roster

CONTEXT_BYTES = 4096
SEARCH_BYTES = 8192
HISTORY_BYTES = 32768
CONTEXT_LIMIT = 8
MAX_PAGE_SIZE = 20
_STOP_WORDS = frozenset("a an and are can could did do for from how i in is it me my of on please the this to was with you".split())


class DirectoryChanged(ValueError):
    pass


class AmbiguousHistory(ValueError):
    pass


def task_id(name: str) -> str:
    """Opaque lookup key for an exact legacy name; not a renameable identity."""
    return hashlib.sha256(name.encode("utf-8")).hexdigest()


def encoded_size(value: Any) -> int:
    return len(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))


def _tokens(value: str) -> set[str]:
    return set(re.findall(r"\w+", value.casefold())) - _STOP_WORDS


class TaskDirectory:
    def __init__(self, roster: AgentRoster, logs: ExecutionAgentLogStore):
        self.roster, self.logs = roster, logs

    def names(self) -> list[str]:
        self.roster.load()
        return list(dict.fromkeys(self.roster.get_agents()))

    def has_collision(self, name: str) -> bool:
        slug = _slugify(name)
        return any(other != name and _slugify(other) == slug for other in self.names())

    def _ranked(self, query: str, include_recent: bool) -> list[dict[str, Any]]:
        names = self.names()
        collisions = Counter(_slugify(name) for name in names)
        terms = _tokens(query)
        ranked = []
        for position, name in enumerate(names):
            overlap = len(terms & _tokens(name))
            exact = bool(query.strip()) and name.casefold() == query.strip().casefold()
            substring = bool(query.strip()) and query.strip().casefold() in name.casefold()
            if query.strip() and not include_recent and not (overlap or substring):
                continue
            activity = self.logs.last_activity(name)
            entry = {
                "id": task_id(name), "name": name[:200], "name_truncated": len(name) > 200,
                "last_activity": activity,
                "history_ambiguous": collisions[_slugify(name)] > 1,
            }
            ranked.append(((exact, overlap, substring, activity or "", position), entry))
        ranked.sort(key=lambda pair: pair[0], reverse=True)
        return [entry for _, entry in ranked]

    def page(self, query: str = "", cursor: Optional[str] = None, limit: int = MAX_PAGE_SIZE,
             *, include_recent: bool = False, byte_limit: int = SEARCH_BYTES) -> dict[str, Any]:
        if not isinstance(query, str) or len(query) > 2048:
            raise ValueError("Search text must be at most 2048 characters")
        if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= MAX_PAGE_SIZE:
            raise ValueError("Page size must be between 1 and 20")
        rows = self._ranked(query, include_recent)
        revision = hashlib.sha256((query.casefold() + json.dumps([r["id"] for r in rows])).encode()).hexdigest()[:16]
        offset = 0
        if cursor is not None:
            if not isinstance(cursor, str) or not re.fullmatch(r"\d{1,12}\.[0-9a-f]{16}", cursor):
                raise ValueError("Invalid directory cursor")
            index, previous = cursor.split(".")
            if previous != revision:
                raise DirectoryChanged("Task list changed. Restart this search without a cursor.")
            offset = int(index)
            if offset > len(rows):
                raise ValueError("Invalid directory cursor")
        result: dict[str, Any] = {"tasks": [], "total": len(rows), "next_cursor": None}
        for row in rows[offset:offset + limit]:
            candidate = {**result, "tasks": [*result["tasks"], row],
                         "next_cursor": f"{offset + len(result['tasks']) + 1}.{revision}"}
            if encoded_size(candidate) > byte_limit:
                break
            result["tasks"].append(row)
        next_offset = offset + len(result["tasks"])
        if next_offset < len(rows):
            result["next_cursor"] = f"{next_offset}.{revision}"
        return result

    def context(self, query: str) -> dict[str, Any]:
        return self.page(query[:2048], limit=CONTEXT_LIMIT, include_recent=True, byte_limit=CONTEXT_BYTES)

    def resolve(self, identifier: str) -> str:
        if not isinstance(identifier, str) or not re.fullmatch(r"[0-9a-f]{64}", identifier):
            raise KeyError("Task not found")
        for name in self.names():
            if task_id(name) == identifier:
                return name
        raise KeyError("Task not found")

    def history(self, identifier: str, offset: int = 0, limit: int = MAX_PAGE_SIZE, *, latest: bool = False, before: Optional[int] = None) -> dict[str, Any]:
        name = self.resolve(identifier)
        if self.has_collision(name):
            raise AmbiguousHistory("These legacy task names share a history file. Their history cannot be safely separated.")
        if not 0 <= offset <= 10_000_000 or not 1 <= limit <= MAX_PAGE_SIZE:
            raise ValueError("Invalid history page")
        if before is not None and not 0 <= before <= 10_000_000:
            raise ValueError("Invalid history cursor")
        if (latest and before is not None) or ((latest or before is not None) and offset != 0):
            raise ValueError("Use offset, latest, or before separately")
        if latest or before is not None:
            records, end = self.logs.read_tail_page(name, limit, before)
            result = {"entries": [], "next_offset": None, "start_offset": end, "before_offset": end or None}
            for index, (tag, timestamp, content) in reversed(records):
                row = {"kind": tag, "timestamp": timestamp, "content": content[:2000], "truncated": len(content) > 2000}
                candidate = {"entries": [row, *result["entries"]], "next_offset": None,
                             "start_offset": index, "before_offset": index or None}
                if encoded_size(candidate) > HISTORY_BYTES:
                    break
                result = candidate
            return result
        entries, has_more = self.logs.read_page(name, offset, limit)
        result: dict[str, Any] = {"entries": [], "next_offset": None}
        for tag, timestamp, content in entries:
            row = {"kind": tag, "timestamp": timestamp, "content": content[:2000], "truncated": len(content) > 2000}
            candidate = {"entries": [*result["entries"], row], "next_offset": offset + len(result["entries"]) + 1}
            if encoded_size(candidate) > HISTORY_BYTES:
                break
            result["entries"].append(row)
        if has_more or len(result["entries"]) < len(entries):
            result["next_offset"] = offset + len(result["entries"])
        return result


def get_task_directory() -> TaskDirectory:
    return TaskDirectory(get_agent_roster(), get_execution_agent_logs())
