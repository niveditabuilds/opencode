import { existsSync } from "node:fs"
import { dirname, join } from "node:path"

export function findRepoRoot(start: string) {
  let current = start
  for (;;) {
    if (existsSync(join(current, "bun.lock")) && existsSync(join(current, "packages", "opencode"))) {
      return current
    }
    const parent = dirname(current)
    if (parent === current) return
    current = parent
  }
}

export type OpencodeLaunch =
  | { kind: "binary"; path: string }
  | { kind: "bun"; entry: string }

export function findOpencodeLaunch(exeDir: string): OpencodeLaunch {
  const explicit = process.env.VOXCODE_OPENCODE_BIN
  if (explicit) {
    if (explicit.endsWith(".ts")) return { kind: "bun", entry: explicit }
    return { kind: "binary", path: explicit }
  }

  const sibling = join(exeDir, process.platform === "win32" ? "opencode.exe" : "opencode")
  if (existsSync(sibling)) return { kind: "binary", path: sibling }

  const onPath = Bun.spawnSync({
    cmd: [process.platform === "win32" ? "where" : "which", "opencode"],
    stdout: "pipe",
    stderr: "ignore",
  })
  if (onPath.exitCode === 0) {
    const path = new TextDecoder().decode(onPath.stdout).trim().split(/\r?\n/)[0]
    if (path) return { kind: "binary", path }
  }

  const repo = findRepoRoot(exeDir) ?? findRepoRoot(process.cwd())
  if (repo) {
    const entry = join(repo, "packages", "opencode", "src", "index.ts")
    if (existsSync(entry)) return { kind: "bun", entry }
  }

  throw new Error(
    "opencode not found.\nInstall opencode (curl -fsSL https://opencode.ai/install | bash) or set VOXCODE_OPENCODE_BIN.",
  )
}
