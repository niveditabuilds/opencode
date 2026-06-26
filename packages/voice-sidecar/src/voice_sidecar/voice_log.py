"""Unified voxcode voice logging — append JSONL entries to ~/.voxcode/logs.jsonl."""

from __future__ import annotations

import json
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

_lock = threading.Lock()
_context: dict[str, dict[str, Any]] = {}


def voxcode_log_path() -> Path:
    return Path.home() / ".voxcode" / "logs.jsonl"


def ensure_voxcode_log() -> Path:
    path = voxcode_log_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.touch(exist_ok=True)
    return path


def set_log_context(voice_id: str | None = None, **fields: Any) -> None:
    key = voice_id or "__global__"
    with _lock:
        current = dict(_context.get(key, {}))
        for name, value in fields.items():
            if value is None:
                current.pop(name, None)
            else:
                current[name] = value
        _context[key] = current


def clear_log_context(voice_id: str | None = None) -> None:
    key = voice_id or "__global__"
    with _lock:
        _context.pop(key, None)


def _resolve_context(voice_id: str | None) -> dict[str, Any]:
    with _lock:
        merged: dict[str, Any] = dict(_context.get("__global__", {}))
        if voice_id:
            merged.update(_context.get(voice_id, {}))
        return merged


def write_log(
    stage: str,
    message: str,
    *,
    source: str = "sidecar",
    voice_id: str | None = None,
    session_id: str | None = None,
    turn_id: int | None = None,
    transport: str | None = None,
    **extra: Any,
) -> None:
    ctx = _resolve_context(voice_id)
    entry: dict[str, Any] = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "source": source,
        "stage": stage,
        "message": message,
    }
    resolved_voice = voice_id or ctx.get("voiceId")
    resolved_session = session_id or ctx.get("sessionId")
    resolved_turn = turn_id if turn_id is not None else ctx.get("turnId")
    resolved_transport = transport or ctx.get("transport")
    if resolved_transport:
        entry["transport"] = resolved_transport
    if resolved_voice:
        entry["voiceId"] = resolved_voice
    if resolved_session:
        entry["sessionId"] = resolved_session
    if resolved_turn is not None:
        entry["turnId"] = resolved_turn
    entry.update(extra)
    append_entries([entry])


def append_entries(entries: list[dict[str, Any]]) -> Path:
    path = ensure_voxcode_log()
    with _lock:
        with path.open("a", encoding="utf-8") as handle:
            for entry in entries:
                handle.write(json.dumps(entry, separators=(",", ":")) + "\n")
    return path


def format_log_line(entry: dict[str, Any]) -> str:
    ts = str(entry.get("ts") or "")
    time = ts[11:23] if len(ts) >= 23 else ts
    ids = []
    voice = entry.get("voiceId")
    if isinstance(voice, str) and voice:
        ids.append(f"v:{voice[-8:]}")
    session = entry.get("sessionId")
    if isinstance(session, str) and session:
        ids.append(f"s:{session[-8:]}")
    turn = entry.get("turnId")
    if turn is not None:
        ids.append(f"t:{turn}")
    prefix = " ".join(ids)
    stage = entry.get("stage") or "LOG"
    message = entry.get("message") or ""
    return f"{time} {prefix + ' ' if prefix else ''}[{stage}] {message}".strip()


# Back-compat helpers used by server routes.
def voice_web_log_path() -> Path:
    return voxcode_log_path()


def ensure_voice_web_log() -> Path:
    return ensure_voxcode_log()


def append_voice_web_log(lines: list[str]) -> Path:
    entries: list[dict[str, Any]] = []
    for line in lines:
        text = str(line).strip()
        if not text:
            continue
        stage = "STATE"
        message = text
        if text.startswith("[") and "]" in text:
            stage, _, rest = text[1:].partition("]")
            message = rest.strip()
        entries.append(
            {
                "ts": datetime.now(timezone.utc).isoformat(),
                "source": "client",
                "stage": stage,
                "message": message,
            }
        )
    return append_entries(entries)


def web_voice_log_line(stage: str, message: str, *, voice_id: str | None = None) -> None:
    write_log(stage, message, source="sidecar", voice_id=voice_id)
