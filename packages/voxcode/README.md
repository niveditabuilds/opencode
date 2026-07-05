<div align="center">

<img src="./site/mic.jpeg" alt="Voxcode" width="420" />

# Voxcode

**Voice-native coding agent.** Talk — it writes the code.

Built on top of [**OpenCode**](https://opencode.ai) · [tryvoxcode.vercel.app](https://tryvoxcode.vercel.app)

</div>

---

## Requirements

- [Bun](https://bun.sh) — to build the bundle
- `XAI_API_KEY` from [console.x.ai](https://console.x.ai) — required for voice
- `ffmpeg` (`ffplay`) on your `PATH` — for terminal voice playback

## Build

From the repo root, build a self-contained bundle for your machine:

```sh
make dist
# → packages/voxcode/dist/voxcode-<os>-<arch>/bin/{voxcode,opencode}
```

Options:

```sh
SKIP_OPENCODE=1 make dist   # reuse the previous opencode binary (faster rebuild)
make clean                  # remove local dist artifacts
make help                   # list targets
```

## Run

Add the bundle to your `PATH`, set your key, and go:

```sh
export PATH="$PWD/packages/voxcode/dist/voxcode-$(uname -s | tr A-Z a-z)-$(uname -m | sed 's/x86_64/x64/;s/aarch64/arm64/')/bin:$PATH"
export XAI_API_KEY="xai-…"

voxcode          # terminal UI + voice
voxcode web      # browser UI + voice
voxcode tui .    # voice in the current directory
```

## Commands

| Command | What it does |
|---|---|
| `voxcode` | Terminal UI + voice |
| `voxcode tui [dir]` | Same, scoped to a directory |
| `voxcode web` | Browser UI + voice |

## Environment

| Variable | Purpose |
|---|---|
| `XAI_API_KEY` | Required for voice |
| `VOXCODE_OPENCODE_BIN` | Path to opencode binary or `index.ts` |
| `VOICE_SIDECAR_URL` | Override voice server URL (default: opencode server URL) |
| `OPENCODE_SERVER_URL` | OpenCode server URL when not using the local daemon |
