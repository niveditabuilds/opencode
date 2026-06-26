<p align="center">
  <img src="packages/voxcode/site/mic.jpeg" alt="Voxcode" width="440">
</p>

<h1 align="center">Voxcode</h1>

<p align="center"><strong>The voice-native AI coding agent.</strong><br>Talk — it writes the code.</p>

<p align="center">
  <a href="https://tryvoxcode.vercel.app">tryvoxcode.vercel.app</a>
</p>

---

Voxcode is an AI coding agent you **talk to**. Voice isn't a bonus feature bolted on the side — it's the primary way you drive the agent. Speak what you want, hear it think, watch it write the code. There is no typing-only mode: if you're using Voxcode, you're using your voice.

It runs entirely on your machine — terminal or browser — with speech-to-text and text-to-speech wired straight into the agent server.

## Requirements

- [Bun](https://bun.sh) — to build from source
- An `XAI_API_KEY` from [console.x.ai](https://console.x.ai) — required for voice
- `ffmpeg` (`ffplay`) on your `PATH` — for terminal voice playback

## Install

Build the self-contained bundle for your machine:

```sh
make dist
```

This produces a standalone `voxcode` (no Bun needed to run it afterward). Add it to your `PATH`:

```sh
export PATH="$PWD/packages/voxcode/dist/voxcode-$(uname -s | tr A-Z a-z)-$(uname -m | sed 's/x86_64/x64/;s/aarch64/arm64/')/bin:$PATH"
```

## Run

```sh
export XAI_API_KEY="xai-…"

voxcode          # terminal UI + voice
voxcode web      # browser UI + voice
voxcode tui .    # voice in the current directory
```

Then just start talking.

## Commands

| Command | What it does |
|---|---|
| `voxcode` | Terminal UI + voice |
| `voxcode tui [dir]` | Same, scoped to a directory |
| `voxcode web` | Browser UI + voice |

See [`packages/voxcode/README.md`](packages/voxcode/README.md) for build options and environment variables.

## Credits

Voxcode is built on top of [**OpenCode**](https://opencode.ai), the open-source AI coding agent — it provides the underlying agent, TUI, and server that Voxcode wraps with its voice layer. Voxcode is an independent project and is not affiliated with or endorsed by the OpenCode team.
