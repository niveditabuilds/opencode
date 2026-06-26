"""Per voice-session harness registry and WSS action outbox.

Utterances are routed inline on the WSS loop, but HTTP-originated updates (progress,
turn_complete) run off-thread and must reach the client over the same WebSocket. Each
session may bind an asyncio outbox; computed actions are pushed onto it thread-safely.
"""

from __future__ import annotations

import asyncio
import threading
from dataclasses import dataclass, field

from .harness import VoiceHarness
from .voice_log import set_log_context, write_log


@dataclass
class _Entry:
    harness: VoiceHarness
    loop: asyncio.AbstractEventLoop | None = None
    outbox: "asyncio.Queue[dict] | None" = None


_entries: dict[str, _Entry] = {}
_lock = threading.Lock()


def create(voice_id: str) -> VoiceHarness:
    harness = VoiceHarness()
    with _lock:
        _entries[voice_id] = _Entry(harness=harness)
    return harness


def get(voice_id: str) -> VoiceHarness | None:
    with _lock:
        entry = _entries.get(voice_id)
    return entry.harness if entry else None


def get_or_create(voice_id: str) -> VoiceHarness:
    with _lock:
        entry = _entries.get(voice_id)
        if entry is None:
            entry = _Entry(harness=VoiceHarness())
            _entries[voice_id] = entry
    return entry.harness


def drop(voice_id: str) -> None:
    with _lock:
        _entries.pop(voice_id, None)


def bind_outbox(voice_id: str, loop: asyncio.AbstractEventLoop, outbox: "asyncio.Queue[dict]") -> None:
    with _lock:
        entry = _entries.get(voice_id)
        if entry is None:
            entry = _Entry(harness=VoiceHarness())
            _entries[voice_id] = entry
        entry.loop = loop
        entry.outbox = outbox


def unbind_outbox(voice_id: str) -> None:
    with _lock:
        entry = _entries.get(voice_id)
        if entry is not None:
            entry.loop = None
            entry.outbox = None


def _emit(voice_id: str, actions: list[dict[str, object]]) -> None:
    with _lock:
        entry = _entries.get(voice_id)
        loop = entry.loop if entry else None
        outbox = entry.outbox if entry else None
        harness = entry.harness if entry else None
    if harness is not None:
        set_log_context(voice_id, voiceId=voice_id, turnId=harness.turn_id)
    if not loop or not outbox or not actions:
        return
    for action in actions:
        loop.call_soon_threadsafe(outbox.put_nowait, action)


def apply_update(voice_id: str, payload: dict[str, object]) -> list[dict[str, object]]:
    harness = get_or_create(voice_id)
    event = str(payload.get("event") or "").strip().lower()
    set_log_context(voice_id, voiceId=voice_id, turnId=harness.turn_id)
    if event == "turn_complete":
        reply = str(payload.get("reply") or payload.get("text") or "")
        write_log("HARNESS", f"turn_complete received chars={len(reply.strip())}", voice_id=voice_id)
        actions = harness.note_turn_complete(reply)
        speak = any(str(item.get("action") or "") == "speak" for item in actions)
        write_log("HARNESS", f"turn_complete actions={len(actions)} speak={speak}", voice_id=voice_id)
    else:
        write_log("STATE", f"harness update event={event or 'update'}", voice_id=voice_id)
        actions = harness.push_update(payload)
    _emit(voice_id, actions)
    return actions
