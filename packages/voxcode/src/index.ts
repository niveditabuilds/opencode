#!/usr/bin/env bun

import { runOpencode } from "./opencode"
import { requireXaiApiKey, xaiApiKeyStatus } from "./xai"

const HELP = `voxcode — Vox Code with voice (local)

Usage:
  voxcode [project]           start terminal UI (voice via /voice when XAI_API_KEY is set)
  voxcode tui [project]       same as above
  voxcode web [flags]         start web UI with voice (requires XAI_API_KEY)
  voxcode <opencode cmd> …    pass through to opencode (no voice)

Environment:
  XAI_API_KEY          required for voice (https://console.x.ai)
  VOXCODE_OPENCODE_BIN path to opencode binary (optional)
  VOICE_SIDECAR_URL    override voice server URL (default: opencode server URL)
  OPENCODE_SERVER_URL  opencode server URL when not using the local daemon
`

const OPENCODE_COMMANDS = new Set([
  "acp",
  "mcp",
  "attach",
  "run",
  "generate",
  "debug",
  "account",
  "console",
  "providers",
  "agent",
  "upgrade",
  "uninstall",
  "serve",
  "models",
  "stats",
  "export",
  "import",
  "github",
  "pr",
  "session",
  "plug",
  "db",
  "completion",
  "help",
])

function voiceMode(args: string[]) {
  if (args.length === 0) return { mode: "tui" as const, opencodeArgs: [] as string[] }
  if (args[0] === "help" || args[0] === "--help" || args[0] === "-h") return { mode: "help" as const, opencodeArgs: [] }
  if (args[0] === "web") return { mode: "web" as const, opencodeArgs: args.slice(1) }
  if (args[0] === "tui") return { mode: "tui" as const, opencodeArgs: args.slice(1) }
  if (args[0] === "version" || args[0] === "--version" || args[0] === "-v") {
    return { mode: "passthrough" as const, opencodeArgs: ["--version"] }
  }
  if (args[0] !== undefined && OPENCODE_COMMANDS.has(args[0])) return { mode: "passthrough" as const, opencodeArgs: args }
  return { mode: "tui" as const, opencodeArgs: args }
}

async function main() {
  const args = process.argv.slice(2)
  const parsed = voiceMode(args)

  if (parsed.mode === "help") {
    process.stdout.write(HELP)
    process.exit(0)
  }

  if (parsed.mode === "passthrough") {
    process.exit(await runOpencode(process.execPath, parsed.opencodeArgs))
  }

  const xai = xaiApiKeyStatus()
  if (parsed.mode === "web" && !xai.ok) {
    requireXaiApiKey()
  }

  if (!xai.ok) {
    process.stderr.write(`voxcode: voice disabled — ${xai.reason}\n`)
    process.stderr.write("voxcode: export XAI_API_KEY, then use /voice in the TUI.\n")
  }

  const opencodeArgs = parsed.mode === "web" ? ["web", ...parsed.opencodeArgs] : parsed.opencodeArgs
  process.exit(await runOpencode(process.execPath, opencodeArgs))
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
