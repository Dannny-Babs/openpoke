"""Separate request journal; legacy conversation and worker files stay intact."""
import json
import hashlib
import sqlite3
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path

TERMINAL = {"succeeded", "failed", "interrupted"}
def now():
    return datetime.now(timezone.utc).isoformat()

class SubmissionConflict(ValueError):
    pass

class RequestStore:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self._db = sqlite3.connect(path, check_same_thread=False)
        self._lock = threading.RLock()
        self._db.execute("CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, submission_id TEXT UNIQUE, fingerprint TEXT NOT NULL, body TEXT NOT NULL)")
        self._db.execute("CREATE TABLE IF NOT EXISTS cleared_submissions (submission_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL)")
        self._db.commit()

    def create(self, text, task_id=None, origin="chat", submission_id=None):
        fingerprint = hashlib.sha256(json.dumps([text, task_id, origin], ensure_ascii=False).encode()).hexdigest()
        with self._lock:
            if submission_id:
                if self._db.execute("SELECT 1 FROM cleared_submissions WHERE submission_id=?", (submission_id,)).fetchone():
                    raise SubmissionConflict("This submission was cleared; retry cannot replay it. Start a new request deliberately.")
                row = self._db.execute("SELECT fingerprint,body FROM requests WHERE submission_id=?", (submission_id,)).fetchone()
                if row:
                    if row[0] != fingerprint:
                        raise SubmissionConflict("Submission ID was already used for a different request")
                    return json.loads(row[1]), False
            stamp = now()
            body = dict(request_id=str(uuid.uuid4()), status="queued", task_id=task_id, origin=origin,
                        error=None, partial_response=None, created_at=stamp, updated_at=stamp, runs=[])
            self._db.execute("INSERT INTO requests VALUES (?,?,?,?)", (body["request_id"], submission_id, fingerprint, json.dumps(body)))
            self._db.commit()
            return body, True

    def get(self, identifier):
        with self._lock:
            row = self._db.execute("SELECT body FROM requests WHERE id=?", (identifier,)).fetchone()
        if not row:
            return None
        body = json.loads(row[0])
        body.setdefault("partial_response", None)
        for run in body["runs"]:
            run.setdefault("partial_response", None)
            run.setdefault("activity", None)
        return body

    def mutate(self, identifier, operation):
        with self._lock:
            body = self.get(identifier)
            if body is None:
                raise KeyError(identifier)
            operation(body)
            body["updated_at"] = now()
            self._db.execute("UPDATE requests SET body=? WHERE id=?", (json.dumps(body), identifier))
            self._db.commit()
            return body

    def update(self, identifier, **fields):
        if fields.get("status") in TERMINAL:
            fields["partial_response"] = None
        return self.mutate(identifier, lambda body: body.update(fields))

    def add_run(self, identifier, task_id, task_name):
        stamp = now()
        run = dict(id=str(uuid.uuid4()), task_id=task_id, task_name=task_name, status="queued", error=None,
                   response=None, partial_response=None, activity=None, created_at=stamp, updated_at=stamp)
        self.mutate(identifier, lambda body: body["runs"].append(run))
        return run

    def update_run(self, identifier, run_id, **fields):
        if fields.get("status") in TERMINAL:
            fields.update(partial_response=None, activity=None)
        def change(body):
            for run in body["runs"]:
                if run["id"] == run_id:
                    run.update(fields, updated_at=now())
                    break
        self.mutate(identifier, change)

    def interrupt_open(self):
        with self._lock:
            rows = self._db.execute("SELECT id FROM requests").fetchall()
            for (identifier,) in rows:
                body = self.get(identifier)
                if body["status"] in TERMINAL:
                    continue
                def interrupt(item):
                    item.update(status="interrupted", partial_response=None, error="Server restarted or stopped. Work may have occurred; no automatic replay.")
                    for run in item["runs"]:
                        if run["status"] not in TERMINAL:
                            run.update(status="interrupted", partial_response=None, activity=None, error=item["error"], updated_at=now())
                self.mutate(identifier, interrupt)

    def clear(self):
        """Remove request content but retain non-replay receipts for transport IDs."""
        with self._lock:
            self._db.execute("INSERT OR IGNORE INTO cleared_submissions SELECT submission_id,fingerprint FROM requests WHERE submission_id IS NOT NULL")
            self._db.execute("DELETE FROM requests")
            self._db.commit()

    def close(self):
        self._db.close()
