"""Voice sidecar CLI — HTTP service and dev helpers.

Transcript/reply text goes to stdout; status and errors go to stderr.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from . import __version__
from .opencode import OpencodeError
from .stt import STTError, default_stt


def _log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def cmd_ask(args: argparse.Namespace) -> int:
    """Text → opencode → reply. Exercises the control plane without a mic."""
    from .opencode import OpencodeClient

    text = " ".join(args.text).strip()
    if not text:
        _log("nothing to ask")
        return 1
    client = OpencodeClient(url=args.server)
    session_id = args.session or client.create_session(args.agent)
    _log(f"session {session_id} — submitting to opencode…")
    reply = client.run_turn(session_id, text, args.agent)
    print(reply or "(no reply)")
    return 0


def cmd_transcribe(args: argparse.Namespace) -> int:
    stt = default_stt()
    path = Path(args.file)
    if not path.exists():
        _log(f"error: file not found: {path}")
        return 2
    text = stt.transcribe(path.read_bytes())
    print(text)
    return 0


def cmd_serve(args: argparse.Namespace) -> int:
    """Run the voice HTTP service."""
    import os

    import uvicorn

    from .server import create_app

    log_level = os.environ.get("VOICE_SIDECAR_LOG_LEVEL") or "warning"
    uvicorn.run(
        create_app,
        factory=True,
        host=args.host,
        port=args.port,
        log_level=log_level,
    )
    return 0


def _add_opencode_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--server",
        default=None,
        help="opencode server URL (default: auto-discover from ~/.local/state/opencode or http://127.0.0.1:4096)",
    )
    parser.add_argument("--session", default=None, help="existing session id (default: create one)")
    parser.add_argument("--agent", default=None, help="agent name when creating a session")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="voice-stt",
        description="voxcode voice sidecar — STT, harness, and opencode control",
    )
    parser.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    parser.set_defaults(func=cmd_serve, host="127.0.0.1", port=8765)

    sub = parser.add_subparsers(dest="command")

    ask = sub.add_parser("ask", help="send text to opencode and print the reply (control-plane smoke test)")
    ask.add_argument("text", nargs="+", help="command to submit")
    _add_opencode_args(ask)
    ask.set_defaults(func=cmd_ask)

    transcribe = sub.add_parser("transcribe", help="transcribe an existing wav file")
    transcribe.add_argument("file", help="path to a 16-bit PCM wav file")
    transcribe.set_defaults(func=cmd_transcribe)

    serve = sub.add_parser("serve", help="run the voice HTTP service")
    serve.add_argument("--host", default="127.0.0.1", help="bind address (default 127.0.0.1)")
    serve.add_argument("--port", type=int, default=8765, help="bind port (default 8765)")
    serve.set_defaults(func=cmd_serve)

    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return args.func(args)
    except STTError as exc:
        _log(f"error: {exc}")
        return 2
    except OpencodeError as exc:
        _log(f"error: {exc}")
        return 2
    except KeyboardInterrupt:
        _log("\ncancelled")
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
