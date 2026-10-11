from __future__ import annotations

import json
from typing import Any, Callable, Dict, List, Optional

import httpx

from ..config import get_settings

OpenRouterBaseURL = "https://openrouter.ai/api/v1"


class OpenRouterError(RuntimeError):
    """Raised when the OpenRouter API returns an error response."""


def _headers(*, api_key: Optional[str] = None) -> Dict[str, str]:
    settings = get_settings()
    key = (api_key or settings.openrouter_api_key or "").strip()
    if not key:
        raise OpenRouterError("Missing OpenRouter API key")

    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
    }

    return headers


def _build_messages(messages: List[Dict[str, str]], system: Optional[str]) -> List[Dict[str, str]]:
    if system:
        return [{"role": "system", "content": system}, *messages]
    return messages


def _handle_response_error(exc: httpx.HTTPStatusError) -> None:
    response = exc.response
    detail: str
    try:
        payload = response.json()
        detail = payload.get("error") or payload.get("message") or json.dumps(payload)
    except Exception:
        detail = response.text
    raise OpenRouterError(f"OpenRouter request failed ({response.status_code}): {detail}") from exc


def _stream_error_detail(error, fallback="Provider stream failed"):
    """Only provider code/message are diagnostic; never dump metadata or request fields."""
    if isinstance(error, dict):
        code = error.get("code")
        message = error.get("message")
        parts = []
        if isinstance(code, (str, int)):
            parts.append(f"code={str(code)[:80]}")
        if isinstance(message, str):
            parts.append(" ".join(message.split())[:500])
        return "; ".join(parts) or fallback
    if isinstance(error, str):
        return " ".join(error.split())[:500]
    return fallback


async def _read_stream(response: httpx.Response, on_content=None) -> Dict[str, Any]:
    """Reassemble public content and tool-call fragments; never publish reasoning/arguments."""
    content = ""
    tool_calls = {}
    finish_reason = None
    usage = None
    seen_choice = False
    done = False
    data_lines = []

    def consume(data):
        nonlocal content, finish_reason, usage, seen_choice, done
        if data == "[DONE]":
            done = True
            return
        try:
            chunk = json.loads(data)
        except (ValueError, TypeError) as exc:
            raise OpenRouterError("Malformed OpenRouter SSE data") from exc
        if not isinstance(chunk, dict):
            raise OpenRouterError("Invalid OpenRouter SSE event")
        if chunk.get("error"):
            error = chunk["error"]
            detail = _stream_error_detail(error)
            raise OpenRouterError(f"OpenRouter stream failed: {detail}")
        if chunk.get("usage"):
            usage = chunk["usage"]
        choices = chunk.get("choices", [])
        if not isinstance(choices, list):
            raise OpenRouterError("Invalid choices in OpenRouter stream")
        for choice in choices:
            if not isinstance(choice, dict):
                raise OpenRouterError("Invalid choice in OpenRouter stream")
            if choice.get("index", 0) != 0:
                continue
            seen_choice = True
            if choice.get("finish_reason"):
                finish_reason = choice["finish_reason"]
                if finish_reason == "error":
                    detail = _stream_error_detail(choice.get("error") or (choice.get("delta") or {}).get("error"), "Provider returned finish_reason=error without diagnostic")
                    raise OpenRouterError(f"OpenRouter stream finished with an error: {detail}")
            delta = choice.get("delta") or {}
            if not isinstance(delta, dict):
                raise OpenRouterError("Invalid delta in OpenRouter stream")
            fragment = delta.get("content")
            if fragment is not None:
                if not isinstance(fragment, str):
                    raise OpenRouterError("Invalid content fragment in OpenRouter stream")
                content += fragment
                if len(content.encode("utf-8")) > 2_000_000:
                    raise OpenRouterError("OpenRouter content exceeded completion limit")
                if fragment and on_content:
                    on_content(fragment)
            pieces = delta.get("tool_calls") or []
            if not isinstance(pieces, list):
                raise OpenRouterError("Invalid tool-call list in OpenRouter stream")
            for piece in pieces:
                if not isinstance(piece, dict):
                    raise OpenRouterError("Invalid tool-call fragment")
                index = piece.get("index")
                if not isinstance(index, int) or index < 0 or index > 127:
                    raise OpenRouterError("Invalid tool-call index in OpenRouter stream")
                call = tool_calls.setdefault(index, {"id": "", "type": "function", "function": {"name": "", "arguments": ""}})
                if piece.get("id"):
                    if not isinstance(piece["id"], str):
                        raise OpenRouterError("Invalid tool-call ID fragment")
                    call["id"] += piece["id"]
                function = piece.get("function") or {}
                if not isinstance(function, dict):
                    raise OpenRouterError("Invalid tool function fragment")
                for key in ("name", "arguments"):
                    value = function.get(key)
                    if value is not None:
                        if not isinstance(value, str):
                            raise OpenRouterError("Invalid tool-call fragment")
                        call["function"][key] += value
                        if len(call["function"][key].encode("utf-8")) > 1_000_000:
                            raise OpenRouterError("OpenRouter tool call exceeded completion limit")
                if sum(len(json.dumps(item).encode()) for item in tool_calls.values()) > 2_000_000:
                    raise OpenRouterError("OpenRouter tool calls exceeded completion limit")

    async for line in response.aiter_lines():
        if line == "":
            if data_lines:
                consume("\n".join(data_lines))
                data_lines.clear()
                if done:
                    break
        elif line.startswith("data:"):
            data_lines.append(line[5:].lstrip(" "))
        # SSE comments, event names and IDs do not contain completion content.
    if data_lines and not done:
        consume("\n".join(data_lines))
    if not done or not seen_choice or not finish_reason:
        raise OpenRouterError("OpenRouter stream ended before a complete response; partial output is not a result")
    if finish_reason not in {"stop", "tool_calls"}:
        raise OpenRouterError(f"OpenRouter response was incomplete ({finish_reason})")
    message = {"role": "assistant", "content": content}
    if tool_calls:
        calls = [tool_calls[index] for index in sorted(tool_calls)]
        if any(not call["id"] or not call["function"]["name"] for call in calls):
            raise OpenRouterError("OpenRouter stream contained an incomplete tool call")
        for call in calls:
            try:
                arguments = json.loads(call["function"]["arguments"] or "{}")
            except json.JSONDecodeError as exc:
                raise OpenRouterError("OpenRouter stream contained incomplete tool arguments") from exc
            if not isinstance(arguments, dict):
                raise OpenRouterError("OpenRouter tool arguments must be an object")
        message["tool_calls"] = calls
    result = {"choices": [{"index": 0, "message": message, "finish_reason": finish_reason}]}
    if usage:
        result["usage"] = usage
    return result


async def request_chat_completion(
    *, model: str, messages: List[Dict[str, str]], system: Optional[str] = None,
    api_key: Optional[str] = None, tools: Optional[List[Dict[str, Any]]] = None,
    base_url: str = OpenRouterBaseURL, on_content: Optional[Callable[[str], None]] = None,
) -> Dict[str, Any]:
    """Consume provider SSE while preserving the runtimes' full-completion interface."""
    payload = {"model": model, "messages": _build_messages(messages, system), "stream": True}
    if tools:
        payload["tools"] = tools
    url = f"{base_url.rstrip('/')}/chat/completions"
    async with httpx.AsyncClient() as client:
        try:
            async with client.stream("POST", url, headers=_headers(api_key=api_key), json=payload, timeout=60.0) as response:
                if response.is_error:
                    await response.aread()
                    try:
                        response.raise_for_status()
                    except httpx.HTTPStatusError as exc:
                        _handle_response_error(exc)
                return await _read_stream(response, on_content)
        except httpx.HTTPError as exc:
            raise OpenRouterError(f"OpenRouter request failed: {exc}") from exc


__all__ = ["OpenRouterError", "request_chat_completion", "OpenRouterBaseURL"]
