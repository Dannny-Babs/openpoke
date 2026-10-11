"""Read-only task discovery and saved history, independent of LLM credentials."""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from ..services.execution.directory import AmbiguousHistory, DirectoryChanged, TaskDirectory, get_task_directory

router = APIRouter(prefix="/tasks", tags=["tasks"])


@router.get("")
def list_tasks(q: str = Query("", max_length=2048), cursor: Optional[str] = Query(None, max_length=64),
               limit: int = Query(20, ge=1, le=20), directory: TaskDirectory = Depends(get_task_directory)):
    try:
        return directory.page(q, cursor, limit)
    except DirectoryChanged as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/{identifier}/history")
def task_history(identifier: str, offset: int = Query(0, ge=0, le=10_000_000),
                 limit: int = Query(20, ge=1, le=20), latest: bool = Query(False),
                 before: Optional[int] = Query(None, ge=0, le=10_000_000),
                 directory: TaskDirectory = Depends(get_task_directory)):
    try:
        return directory.history(identifier, offset, limit, latest=latest, before=before)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Task not found") from exc
    except AmbiguousHistory as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/{identifier}")
def task_metadata(identifier: str, directory: TaskDirectory = Depends(get_task_directory)):
    """Resolve one exact saved task without reading or exposing its history."""
    try:
        name = directory.resolve(identifier)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Task not found") from exc
    return {
        "id": identifier,
        "name": name[:200],
        "name_truncated": len(name) > 200,
        "history_ambiguous": directory.has_collision(name),
        "last_activity": directory.logs.last_activity(name),
    }
