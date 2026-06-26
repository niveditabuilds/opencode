<div align="center">

<img src="./site/mic.jpeg" alt="Voxcode" width="420" />

# Voxcode

**Voice-native coding agent.** Talk — it writes the code.

One local command starts the coding agent with voice built right into the server.

Built on top of [**OpenCode**](https://opencode.ai) · [tryvoxcode.vercel.app](https://tryvoxcode.vercel.app)

</div>

---

## Requirements

- `XAI_API_KEY` from [console.x.ai](https://console.x.ai)
- For **dev** from source: [OpenCode](https://opencode.ai) or this repo
- For **built bundles**: nothing extra — the bundle is self-contained
- TUI voice streaming playback requires **ffmpeg** (`ffplay`) on PATH

## Quick start (dev)

```sh
export XAI_API_KEY="xai-…"

# from repo root
bun run --cwd packages/voxcode dev web
bun run --cwd packages/voxcode dev
bun run --cwd packages/voxcode dev tui ./my-project
```

Or link the bin:

```sh
export PATH="$PWD/packages/voxcode/bin:$PATH"
voxcode web
```

## Build a local install bundle

From repo root:

```sh
make dist
```

Or use the dev helper script (also stops stale opencode processes first):

```sh
./scripts/voxcode-local.sh
```

Manual build:

```sh
bun run --cwd packages/voxcode build --single
# → packages/voxcode/dist/voxcode-darwin-arm64/
#     bin/voxcode
#     bin/opencode
```

Add the `bin` directory to your PATH:

```sh
export PATH="$PWD/packages/voxcode/dist/voxcode-darwin-arm64/bin:$PATH"
voxcode web
```

The build bundles **voxcode** and **opencode** (TUI + embedded web UI + in-process voice on `/voice/*`).

Fast rebuild:

```sh
SKIP_OPENCODE=1 make dist
VOXCODE_SKIP_OPENCODE=1 ./scripts/voxcode-local.sh
```

## Commands

| Command | What it does |
|---|---|
| `voxcode` | Terminal UI + voice |
| `voxcode tui [dir]` | Same |
| `voxcode web` | Web UI in browser + voice |
| `voxcode run …` | Pass-through to opencode (no voice) |

## Environment

| Variable | Purpose |
|---|---|
| `XAI_API_KEY` | Required for voice |
| `VOXCODE_OPENCODE_BIN` | Path to opencode binary or `index.ts` |
| `VOICE_SIDECAR_URL` | Override voice server URL (default: opencode server URL) |
| `OPENCODE_SERVER_URL` | OpenCode server URL when not using the local daemon |

## Credits

Voxcode is built on top of [**OpenCode**](https://opencode.ai) — the open-source AI coding agent. Voxcode wraps OpenCode's TUI, web UI, and server with a voice layer (STT/TTS over `/voice/*`) so you can talk to the agent instead of typing. All the underlying coding agent capability comes from the OpenCode project — huge thanks to its authors and community.
