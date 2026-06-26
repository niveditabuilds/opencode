"""Emit harness actions over the composer WSS.

``speak`` actions are streamed: the text is handed to the per-session :class:`Speaker`,
which feeds the xAI streaming TTS WebSocket and relays PCM ``audio.delta`` frames to the
client so playback starts before synthesis finishes. Other actions are forwarded as-is.
"""

from __future__ import annotations

import asyncio
import json

from starlette.websockets import WebSocket, WebSocketState

from . import harness_store
from .harness import PERIODIC_INTERVAL_S
from .speaker import Speaker
from .voice_log import set_log_context, write_log


async def send_json(websocket: WebSocket, payload: dict) -> None:
    if websocket.client_state != WebSocketState.CONNECTED:
        return
    await websocket.send_text(json.dumps(payload))


async def emit_harness_actions(
    websocket: WebSocket,
    actions: list[dict[str, object]],
    speaker: Speaker | None = None,
    *,
    voice_id: str | None = None,
) -> None:
    harness = harness_store.get(voice_id) if voice_id else None
    if voice_id and harness is not None:
        set_log_context(voice_id, voiceId=voice_id, turnId=harness.turn_id)
    for item in actions:
        action = str(item.get("action") or "").strip()
        if not action:
            continue
        if action == "interrupt" and speaker is not None:
            write_log("HARNESS", "interrupt", voice_id=voice_id)
            speaker.interrupt()
        if action == "speak" and speaker is not None:
            text = str(item.get("text") or "")
            trigger = str(item.get("trigger") or "")
            write_log("HARNESS", f"speak stream trigger={trigger} chars={len(text)}", voice_id=voice_id)
            await send_json(
                websocket,
                {"type": "action", "action": "trace", "text": f"speak stream trigger={trigger} chars={len(text)}"},
            )
            await speaker.speak(text, trigger)
            continue
        if action == "submit_turn":
            turn = item.get("turnId")
            write_log("HARNESS", f"submit_turn turnId={turn} chars={len(str(item.get('text') or ''))}", voice_id=voice_id)
        await send_json(websocket, {"type": "action", **item})
        if action == "set_phase":
            phase = str(item.get("phase") or "listening")
            state = "working" if phase == "working" else "listening"
            await send_json(websocket, {"type": "status", "state": state})


async def periodic_harness_loop(
    websocket: WebSocket,
    voice_id: str,
    stop: asyncio.Event,
    speaker: Speaker | None = None,
) -> None:
    while not stop.is_set():
        try:
            await asyncio.wait_for(stop.wait(), timeout=float(PERIODIC_INTERVAL_S))
            return
        except asyncio.TimeoutError:
            pass
        harness = harness_store.get(voice_id)
        if harness is None:
            continue
        actions = await asyncio.to_thread(harness.periodic_tick)
        if actions:
            await emit_harness_actions(websocket, actions, speaker, voice_id=voice_id)


async def outbox_harness_loop(
    websocket: WebSocket,
    outbox: "asyncio.Queue[dict]",
    stop: asyncio.Event,
    speaker: Speaker | None = None,
    *,
    voice_id: str | None = None,
) -> None:
    """Drain actions queued by HTTP updates (progress, turn_complete) onto the WSS."""
    while not stop.is_set():
        try:
            action = await asyncio.wait_for(outbox.get(), timeout=0.3)
        except asyncio.TimeoutError:
            continue
        await emit_harness_actions(websocket, [action], speaker, voice_id=voice_id)
