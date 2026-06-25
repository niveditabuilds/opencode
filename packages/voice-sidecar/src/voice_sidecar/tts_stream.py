"""Streaming text-to-speech over xAI's bidirectional WebSocket TTS.

Protocol (https://docs.x.ai/developers/model-capabilities/audio/text-to-speech):
  - connect to wss://api.x.ai/v1/tts with codec/voice/language in query params + Bearer
  - send ``{"type":"text.delta","delta":"..."}`` chunks, then ``{"type":"text.done"}``
  - server streams ``{"type":"audio.delta","delta":"<base64>"}`` then ``{"type":"audio.done"}``
  - cancel an in-flight utterance with ``{"type":"text.clear"}`` (server replies audio.clear)

We request raw ``pcm`` so the browser can schedule gapless Web Audio buffers without
container/frame-boundary alignment issues.
"""

from __future__ import annotations

import base64
import json
import os
from typing import AsyncIterator, Callable
from urllib.parse import urlencode

import websockets

from .stream import _websocket_ssl, require_xai_api_key
from .tts import TTSError

# Cap an individual text.delta well under the 15k API limit and split on sentence
# boundaries so synthesis can begin before the whole utterance is sent.
_MAX_DELTA_CHARS = 400


def _chunk_text(text: str) -> list[str]:
    stripped = text.strip()
    if not stripped:
        return []
    chunks: list[str] = []
    current = ""
    for token in _split_sentences(stripped):
        if current and len(current) + len(token) > _MAX_DELTA_CHARS:
            chunks.append(current)
            current = token
        else:
            current = f"{current} {token}".strip() if current else token
    if current:
        chunks.append(current)
    return chunks


def _split_sentences(text: str) -> list[str]:
    out: list[str] = []
    buf = ""
    for ch in text:
        buf += ch
        if ch in ".!?" and len(buf.strip()) > 1:
            out.append(buf.strip())
            buf = ""
    if buf.strip():
        out.append(buf.strip())
    return out


class XaiTtsStream:
    """Synthesize speech incrementally, yielding raw PCM16 chunks as they arrive."""

    def __init__(
        self,
        *,
        api_key: str | None = None,
        base_url: str | None = None,
        voice: str | None = None,
        language: str | None = None,
        sample_rate: int = 24000,
    ) -> None:
        self.api_key = (api_key or require_xai_api_key()).strip()
        base = (base_url or os.environ.get("XAI_BASE_URL") or "https://api.x.ai/v1").rstrip("/")
        ws_base = base.replace("https://", "wss://").replace("http://", "ws://")
        self.voice = voice or os.environ.get("VOICE_TTS_VOICE") or "eve"
        self.language = language or os.environ.get("VOICE_TTS_LANGUAGE") or "en"
        self.sample_rate = sample_rate
        query = urlencode(
            {
                "language": self.language,
                "voice": self.voice,
                "codec": "pcm",
                "sample_rate": sample_rate,
            }
        )
        self.url = f"{ws_base}/tts?{query}"

    async def synthesize(self, text: str, *, should_continue: Callable[[], bool]) -> AsyncIterator[bytes]:
        chunks = _chunk_text(text)
        if not chunks:
            return
        headers = {"Authorization": f"Bearer {self.api_key}"}
        try:
            async with websockets.connect(
                self.url,
                additional_headers=headers,
                ssl=_websocket_ssl(),
                open_timeout=10,
                close_timeout=5,
            ) as ws:
                for chunk in chunks:
                    await ws.send(json.dumps({"type": "text.delta", "delta": chunk}))
                await ws.send(json.dumps({"type": "text.done"}))
                async for message in ws:
                    if isinstance(message, (bytes, bytearray)):
                        continue
                    event = json.loads(message)
                    kind = event.get("type")
                    if kind == "audio.delta":
                        if not should_continue():
                            await ws.send(json.dumps({"type": "text.clear"}))
                            return
                        pcm = base64.b64decode(event.get("delta") or "")
                        if pcm:
                            yield pcm
                    elif kind == "audio.done":
                        return
                    elif kind == "audio.clear":
                        return
                    elif kind == "error":
                        raise TTSError(str(event.get("message") or "tts stream error"))
        except websockets.InvalidStatus as exc:
            raise TTSError(f"TTS stream rejected (HTTP {exc.response.status_code})") from exc
        except OSError as exc:
            raise TTSError(f"TTS stream connection failed: {exc}") from exc
