"""Per-session speaker: stream synthesized audio to the client over the session WSS.

The harness decides *what* to say (a ``speak`` action carrying text). The speaker turns
that into a streamed utterance: text is fed to the xAI streaming TTS WebSocket and the
resulting PCM chunks are relayed to the client as ``audio.delta`` frames, so playback can
begin before synthesis finishes.

One utterance plays at a time (``_lock``). ``interrupt()`` bumps a generation counter so an
in-flight utterance stops emitting and cancels the upstream TTS stream.
"""

from __future__ import annotations

import asyncio
import base64
import json

from starlette.websockets import WebSocket, WebSocketState

from .tts import TTSError
from .tts_stream import XaiTtsStream


class Speaker:
    def __init__(self, websocket: WebSocket) -> None:
        self.websocket = websocket
        self._tts = XaiTtsStream()
        self._lock = asyncio.Lock()
        self._generation = 0

    def interrupt(self) -> None:
        self._generation += 1

    async def _send(self, payload: dict) -> None:
        if self.websocket.client_state != WebSocketState.CONNECTED:
            return
        await self.websocket.send_text(json.dumps(payload))

    async def speak(self, text: str, trigger: str) -> None:
        body = (text or "").strip()
        if not body:
            return
        async with self._lock:
            generation = self._generation

            def should_continue() -> bool:
                return generation == self._generation and self.websocket.client_state == WebSocketState.CONNECTED

            await self._send(
                {"type": "audio.start", "trigger": trigger, "sampleRate": self._tts.sample_rate, "codec": "pcm"}
            )
            try:
                async for pcm in self._tts.synthesize(body, should_continue=should_continue):
                    if not should_continue():
                        break
                    await self._send({"type": "audio.delta", "data": base64.b64encode(pcm).decode("ascii")})
            except TTSError as exc:
                await self._send({"type": "audio.error", "message": str(exc)})
            finally:
                await self._send({"type": "audio.end"})
