import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import { writeFile, unlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { voiceLogStage } from "#log"

let player: ChildProcess | undefined

export function stopMp3() {
  if (!player) return
  voiceLogStage("PLAY", "stop player")
  player.kill("SIGKILL")
  player = undefined
}

function requireFfplay() {
  const check = spawnSync("ffplay", ["-version"], { stdio: "ignore" })
  if (check.error || check.status !== 0) {
    throw new Error("ffplay is required for TUI voice playback — install ffmpeg (e.g. brew install ffmpeg)")
  }
}

function spawnStreamPlayer(sampleRate: number) {
  stopMp3()
  const args = [
    "-nodisp",
    "-autoexit",
    "-loglevel",
    "error",
    "-f",
    "s16le",
    "-ar",
    String(sampleRate),
    "-ac",
    "1",
    "-i",
    "pipe:0",
  ]
  voiceLogStage("PLAY", `stream spawn ffplay ${args.join(" ")}`)
  const child = spawn("ffplay", args, { stdio: ["pipe", "ignore", "ignore"] })
  player = child
  return child
}

function run(command: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    stopMp3()
    voiceLogStage("PLAY", `spawn ${command} ${args.join(" ")}`)
    const child = spawn(command, args, { stdio: "ignore" })
    player = child
    child.on("error", (error) => {
      if (player === child) player = undefined
      voiceLogStage("PLAY", `spawn error ${error.message}`)
      reject(error)
    })
    child.on("exit", (code, signal) => {
      if (player === child) player = undefined
      if (code === 0 || code === null || signal === "SIGTERM" || signal === "SIGKILL") {
        voiceLogStage("PLAY", `${command} exit ok`)
        resolve()
        return
      }
      voiceLogStage("PLAY", `${command} exit code=${code}`)
      reject(new Error(`${command} exited with code ${code}`))
    })
  })
}

async function playFile(file: string) {
  if (process.platform === "darwin") {
    await run("afplay", [file])
    return
  }
  if (process.platform === "linux") {
    for (const command of ["mpv", "ffplay"]) {
      try {
        await run(command, ["--really-quiet", file])
        return
      } catch (error) {
        voiceLogStage("PLAY", `${command} failed ${error instanceof Error ? error.message : error}`)
      }
    }
  }
  throw new Error("could not play voice audio — install afplay, mpv, or ffplay")
}

export async function playMp3(bytes: Uint8Array) {
  const file = join(tmpdir(), `opencode-voice-${Date.now()}.mp3`)
  voiceLogStage("PLAY", `write ${bytes.length} bytes → ${file}`)
  await writeFile(file, bytes)
  try {
    await playFile(file)
  } finally {
    await unlink(file).catch(() => {})
  }
}

export type AudioSink = {
  push: (pcm: Uint8Array) => void
  end: () => Promise<void>
  stop: () => void
}

/**
 * Stream raw PCM16 mono to ffplay stdin so playback starts as chunks arrive.
 * ffplay is bundled with ffmpeg, which TUI voice already requires for mic capture.
 */
export function createAudioSink(opts: { sampleRate: number }): AudioSink {
  let stopped = false
  let child: ChildProcess | undefined
  let stdin: NodeJS.WritableStream | undefined
  let checkedFfplay = false
  let count = 0
  let bytesWritten = 0

  const ensurePlayer = () => {
    if (child || stopped) return
    if (!checkedFfplay) {
      requireFfplay()
      checkedFfplay = true
    }
    child = spawnStreamPlayer(opts.sampleRate)
    stdin = child.stdin ?? undefined
    if (!stdin) throw new Error("ffplay stream player failed to open stdin")
  }

  const push = (pcm: Uint8Array) => {
    if (stopped || !pcm.byteLength) return
    ensurePlayer()
    if (!stdin || stopped) return
    stdin.write(pcm)
    count++
    bytesWritten += pcm.byteLength
  }

  const end = async () => {
    if (stopped || !child || !stdin || !bytesWritten) return
    const active = child
    const input = stdin
    await new Promise<void>((resolve) => {
      active.once("exit", () => resolve())
      input.end()
    })
    if (player === active) player = undefined
    child = undefined
    stdin = undefined
    voiceLogStage("PLAY", `stream end after ${count} chunks`)
  }

  const stop = () => {
    if (stopped) return
    stopped = true
    voiceLogStage("PLAY", "stream stop")
    if (child) {
      child.kill("SIGKILL")
      if (player === child) player = undefined
    }
    child = undefined
    stdin = undefined
    stopMp3()
  }

  return { push, end, stop }
}

export { voiceSidecarBaseUrl } from "#sidecar-url"
