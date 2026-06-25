"""Voice session harness — the LLM-driven brain for a composer voice session.

The harness owns conversation phase, an activity buffer, and the triggers that turn
buffered agent activity into spoken updates. The client is a thin transport: it streams
mic audio in, posts activity updates, and obeys the actions emitted here.

Triggers:
- utterance: user spoke -> LLM router decides submit / interrupt / status / reply / ignore
- periodic (every PERIODIC_INTERVAL_S while working): summarize buffer -> speak, flush, keep seed
- turn_complete: normalize the final reply -> speak, purge buffer
- status (user asks "what's up"): summarize buffer -> speak, flush, keep seed

There are no keyword heuristics in the decision path. The only non-LLM behavior is a
minimal safety fallback used when an LLM call fails outright.
"""

from __future__ import annotations

import json
import threading
import time
from dataclasses import dataclass, field

from .speech_summary import voice_summary
from .stt import STTError
from .xai_chat import ChatError, chat_complete, parse_json_object

PERIODIC_INTERVAL_S = 10

_ROUTER_SYSTEM = """You are the controller for a hands-free voice coding assistant.

The user talks while an agent may be idle (listening), working, or speaking. Given the
current state and the user's utterance, choose exactly one action and return JSON only.

Actions:
- {"action":"submit_turn"}   send the utterance to the agent as a request
- {"action":"redirect"}       user changed direction mid-task: interrupt, then send
- {"action":"interrupt"}      user wants the agent or current speech to stop
- {"action":"status"}         user asked what's happening / progress
- {"action":"ignore"}         nothing actionable: assistant echo, or contentless filler

Rules:
- phase=listening: DEFAULT to submit_turn. Any question, request, instruction, or remark
  addressed to the assistant is submit_turn — even when casual or prefixed with a greeting
  ("hey, can you…", "so I was thinking…", "are you able to…"). Choose ignore ONLY when the
  utterance is either (a) a near-repeat of lastSpoken (the assistant's own TTS leaking into
  the mic), or (b) contentless filler standing alone ("um", "uh", "okay", "thanks", "hmm",
  a cough). When unsure, choose submit_turn.
- phase=working: a new or different task is redirect; "stop"/"cancel"/"wait" is interrupt;
  a question about progress is status; contentless filler or echo is ignore; an ordinary
  follow-up request is submit_turn.
- phase=speaking: "stop"/"quiet"/"wait" is interrupt; a near-repeat of lastSpoken is ignore
  (it's the assistant's own audio); a clear new request is redirect; otherwise ignore.

Examples:
- listening + "Hey, are you able to see what I'm typing?" -> {"action":"submit_turn"}
- listening + "okay" -> {"action":"ignore"}
- working + "actually use Postgres instead" -> {"action":"redirect"}
- working + "how's it going?" -> {"action":"status"}
- speaking + "stop" -> {"action":"interrupt"}

Return JSON only, e.g. {"action":"submit_turn"}"""

_BUFFER_SUMMARY_SYSTEM = """You summarize recent agent activity for short voice TTS.

Rules:
- 1-3 natural spoken sentences, under 220 characters when possible.
- Cover the most recent meaningful progress (thinking, tools, results).
- Skip markdown, code blocks, file paths, and URLs.

The updates should be significant. If the only updates are I have done 3 searches or I have read 2 files or x system calls. 

It should just say still working on it

- Be conversational ("I'm still working on…", "So far I've…").

Return plain spoken text only — no JSON."""

_TURN_COMPLETE_SYSTEM = """You voice an assistant reply for a hands-free coding companion, writing text
that will be spoken by an expressive TTS engine. Annotate it with the engine's speech tags so it
sounds genuinely human.

Content rules:
- 1-3 spoken sentences, under 280 characters unless the reply is already very short.
- Skip markdown, code blocks, paths, and URLs.
- If the reply is long, give the gist and say details are on screen.

Emotion — let the tone match what actually happened:
- Wins (fixed, shipped, tests pass): sound pleased or relieved.
- Setbacks (errors, failures, stuck): sound concerned or apologetic, not chipper.
- Questions / needing input: sound curious and inviting.
- Routine progress: calm and easygoing.

Speech tags — weave these in where the emotion naturally lands. Use ONLY these tags:
- Inline (a moment): [pause], [long-pause], [laugh], [sigh], [breath]
- Wrapping (a span): <whisper>...</whisper>, <excited>...</excited>
Examples:
- "Phew. [sigh] Tests are finally green."
- "Hmm… [pause] that didn't work. Let me look closer."
- "Okay — <excited>it's all wired up!</excited>"

Tag rules:
- Use tags sparingly: at most one or two per reply, only when they fit. Plain text is fine.
- Combine with punctuation rather than stacking tags.
- Every wrapping tag must be closed. Never invent tags outside the lists above.
- The tags are delivery cues, not words — never describe them.

Return the tagged spoken text only — no JSON."""


@dataclass
class BufferEntry:
    kind: str
    text: str
    at: float


@dataclass
class VoiceHarness:
    phase: str = "listening"
    working: bool = False
    buffer: list[BufferEntry] = field(default_factory=list)
    summary_seed: str = ""
    last_spoken: str = ""
    last_submitted: str = ""
    progress: dict[str, object] = field(default_factory=dict)
    last_periodic_at: float = 0.0
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    # ----- update ingest -------------------------------------------------

    def push_update(self, payload: dict[str, object]) -> None:
        with self._lock:
            self._push_update_locked(payload)

    def _push_update_locked(self, payload: dict[str, object]) -> None:
        event = str(payload.get("event") or payload.get("kind") or "update").strip().lower()
        if event == "working":
            self.working = bool(payload.get("working"))
            if self.working:
                self.phase = "working"
            elif self.phase == "working":
                self.phase = "listening"
            return
        if event == "progress":
            self.progress = _coerce_progress(payload)
            self.buffer.append(
                BufferEntry(kind="progress", text=json.dumps(self.progress, sort_keys=True), at=time.time())
            )
            return
        text = str(payload.get("text") or payload.get("detail") or payload.get("reply") or "").strip()
        if not text:
            return
        self.buffer.append(BufferEntry(kind=event, text=text, at=time.time()))

    # ----- triggers ------------------------------------------------------

    def route_utterance(self, text: str) -> list[dict[str, object]]:
        stripped = text.strip()
        if not stripped:
            return []
        with self._lock:
            action = self._route_locked(stripped)
            trace = {"action": "trace", "text": f"decision={action} phase={self.phase} working={self.working} \u00ab{stripped[:48]}\u00bb"}
            return [trace, *self._apply_route_locked(stripped, action)]

    def note_turn_complete(self, reply: str) -> list[dict[str, object]]:
        with self._lock:
            self.working = False
            self.phase = "listening"
            buffer_n = self._buffer_count_locked()
            buffer_text = self._buffer_text_locked()
            prompt = reply.strip()
            if buffer_text:
                prompt = f"activity so far:\n{buffer_text}\n\nfinal reply:\n{reply.strip()}"
            speak = self._spoken_text(prompt, _TURN_COMPLETE_SYSTEM, fallback=voice_summary(reply))
            self.buffer = []
            self.summary_seed = ""
            self.progress = {}
            if speak:
                self.last_spoken = speak
            actions: list[dict[str, object]] = [
                {"action": "trace", "text": f"turn_complete flush entries={buffer_n} spoke={bool(speak)}"},
                {"action": "set_phase", "phase": "listening"},
                {"action": "clear_expect_reply"},
            ]
            if speak:
                actions.insert(1, {"action": "speak", "text": speak, "trigger": "turn_complete"})
            return actions

    def periodic_tick(self) -> list[dict[str, object]]:
        with self._lock:
            now = time.time()
            if self.phase != "working" or not self.working:
                return []
            if now - self.last_periodic_at < PERIODIC_INTERVAL_S:
                return []
            if not self.buffer:
                return []
            self.last_periodic_at = now
            buffer_n = self._buffer_count_locked()
            speak = self._summarize_buffer_locked(trigger="periodic")
            trace = {"action": "trace", "text": f"periodic flush entries={buffer_n} spoke={bool(speak)}"}
            if not speak:
                return [trace]
            self.last_spoken = speak
            return [trace, {"action": "speak", "text": speak, "trigger": "periodic"}]

    # ----- routing internals --------------------------------------------

    def _route_locked(self, text: str) -> str:
        if self.phase == "listening" and not self.working:
            # Default new utterances to a turn; the router still vetoes chit-chat below.
            default = "submit_turn"
        else:
            default = "ignore"
        user = (
            f"phase={self.phase}\n"
            f"working={self.working}\n"
            f"lastSpoken={self.last_spoken[:400]}\n"
            f"utterance={text}"
        )
        try:
            payload = parse_json_object(chat_complete(system=_ROUTER_SYSTEM, user=user, max_tokens=32))
        except (ChatError, STTError):
            return default
        action = str(payload.get("action") or "").strip().lower()
        if action not in {"submit_turn", "redirect", "interrupt", "status", "ignore"}:
            return default
        return action

    def _apply_route_locked(self, text: str, action: str) -> list[dict[str, object]]:
        if action == "interrupt":
            self.working = False
            self.phase = "listening"
            return [
                {"action": "interrupt"},
                {"action": "set_phase", "phase": "listening"},
                {"action": "clear_expect_reply"},
            ]
        if action == "status":
            buffer_n = self._buffer_count_locked()
            speak = self._summarize_buffer_locked(trigger="status")
            actions: list[dict[str, object]] = [
                {"action": "trace", "text": f"status flush entries={buffer_n} spoke={bool(speak)}"},
                {"action": "set_phase", "phase": self.phase},
            ]
            if speak:
                self.last_spoken = speak
                actions.insert(1, {"action": "speak", "text": speak, "trigger": "status"})
            return actions
        if action in {"submit_turn", "redirect"}:
            self.working = True
            self.phase = "working"
            self.last_submitted = text
            actions = []
            if action == "redirect":
                actions.append({"action": "interrupt"})
            actions += [
                {"action": "submit_turn", "text": text},
                {"action": "expect_reply"},
                {"action": "set_phase", "phase": "working"},
            ]
            return actions
        return []

    def _summarize_buffer_locked(self, *, trigger: str) -> str:
        body = self._buffer_text_locked()
        if not body and not self.summary_seed:
            return ""
        user = f"trigger={trigger}\n"
        if self.summary_seed:
            user += f"prior summary:\n{self.summary_seed}\n\n"
        user += f"updates:\n{body or '(none)'}"
        speak = self._spoken_text(user, _BUFFER_SUMMARY_SYSTEM, fallback=self.summary_seed or "Still working on that.")
        self.buffer = []
        if speak:
            self.summary_seed = speak
            self.buffer.append(BufferEntry(kind="summary", text=speak, at=time.time()))
        return speak

    def _buffer_count_locked(self) -> int:
        return sum(1 for entry in self.buffer if entry.kind != "summary")

    def _buffer_text_locked(self) -> str:
        lines: list[str] = []
        for entry in self.buffer:
            if entry.kind == "summary":
                continue
            label = entry.kind.replace("_", " ")
            lines.append(f"[{label}] {entry.text}".strip())
        return "\n".join(lines).strip()

    def _spoken_text(self, user: str, system: str, *, fallback: str) -> str:
        try:
            return chat_complete(system=system, user=user, max_tokens=160).strip()
        except (ChatError, STTError):
            return fallback.strip()


def _coerce_progress(payload: dict[str, object]) -> dict[str, object]:
    if isinstance(payload.get("progress"), dict):
        return dict(payload["progress"])
    return {key: payload[key] for key in ("reads", "searches", "lists", "shell", "thinking") if key in payload}
