"""Plan the spoken form of a finished assistant reply (output-only TTS path)."""

from __future__ import annotations

from .speech_summary import looks_like_long_form, strip_markdown_inline, voice_summary
from .voice_phrases import pick_offer_phrase


def extract_closing_question(text: str) -> str | None:
    stripped = text.strip()
    if not stripped:
        return None
    flattened = strip_markdown_inline(stripped.replace("\n", " "))
    idx = flattened.rfind("?")
    if idx == -1:
        return None
    start = max(flattened.rfind(".", 0, idx), flattened.rfind("!", 0, idx), -1)
    candidate = flattened[start + 1 : idx + 1].strip()
    if len(candidate) >= 3:
        return candidate
    lines = [strip_markdown_inline(line.strip()) for line in stripped.splitlines() if line.strip()]
    for line in reversed(lines):
        if line.endswith("?"):
            return line
    return None


def build_action_offer(closing: str) -> str:
    body = closing.rstrip("?").strip()
    lower = body.lower()
    for prefix in ("want me to ", "should i ", "would you like me to ", "do you want me to "):
        if lower.startswith(prefix):
            body = body[len(prefix) :].strip()
            break
    if not body:
        body = closing.rstrip("?").strip()
    return f"Want me to read more, or go ahead and {body[0].lower() + body[1:] if body else body}?"


def plan_final_speech(text: str) -> dict[str, object]:
    full = text.strip()
    gist = voice_summary(full)
    if not gist:
        return {"parts": [], "hasOffer": False, "fullText": full, "closingQuestion": None, "actionOffer": False}

    parts = [gist]
    has_offer = looks_like_long_form(full) or len(full.strip()) > len(gist.strip()) + 15
    closing = extract_closing_question(full) if has_offer else None
    if has_offer:
        parts.append(build_action_offer(closing) if closing else pick_offer_phrase())
    return {
        "parts": parts,
        "hasOffer": has_offer,
        "fullText": full,
        "closingQuestion": closing,
        "actionOffer": bool(closing),
    }
