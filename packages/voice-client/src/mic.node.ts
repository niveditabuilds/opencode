import type { Subprocess } from "bun"
import { voiceLogStage } from "#log"

export type MicCapture = {
  start: () => Promise<void>
  stop: () => void
  setEnabled: (enabled: boolean) => void
}

const SAMPLE_RATE = 16000

function micInput() {
  const device = process.env.VOICE_MIC_DEVICE?.trim()
  if (device) return device
  if (process.platform === "darwin") return ":0"
  if (process.platform === "linux") return "default"
  if (process.platform === "win32") return "audio=Microphone"
  throw new Error(`TUI voice mic capture is not supported on ${process.platform}`)
}

function ffmpegMicArgs() {
  if (process.platform === "darwin") {
    return ["-hide_banner", "-loglevel", "error", "-f", "avfoundation", "-i", micInput(), "-ar", String(SAMPLE_RATE), "-ac", "1", "-f", "s16le", "-"]
  }
  if (process.platform === "linux") {
    return ["-hide_banner", "-loglevel", "error", "-f", "alsa", "-i", micInput(), "-ar", String(SAMPLE_RATE), "-ac", "1", "-f", "s16le", "-"]
  }
  if (process.platform === "win32") {
    return ["-hide_banner", "-loglevel", "error", "-f", "dshow", "-i", micInput(), "-ar", String(SAMPLE_RATE), "-ac", "1", "-f", "s16le", "-"]
  }
  throw new Error(`TUI voice mic capture is not supported on ${process.platform}`)
}

function requireFfmpeg() {
  const check = Bun.spawnSync({ cmd: ["ffmpeg", "-version"], stdout: "ignore", stderr: "ignore" })
  if (check.exitCode !== 0) {
    throw new Error("ffmpeg is required for TUI voice — install it (e.g. brew install ffmpeg)")
  }
}

export function createMicCapture(input: {
  sendPcm: (buffer: ArrayBuffer) => void
  isRunning: () => boolean
  onError?: (message: string) => void
}): MicCapture {
  let enabled = false
  let child: Subprocess | undefined
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  let sentBytes = 0

  const fail = (message: string) => {
    voiceLogStage("MIC", message)
    input.onError?.(message)
    stop()
  }

  const stop = () => {
    enabled = false
    sentBytes = 0
    if (reader) void reader.cancel().catch(() => {})
    reader = undefined
    if (child) {
      try {
        child.kill()
      } catch {
        // already exited
      }
    }
    child = undefined
  }

  const setEnabled = (value: boolean) => {
    enabled = value && input.isRunning()
  }

  const start = async () => {
    requireFfmpeg()
    const args = ffmpegMicArgs()
    voiceLogStage("MIC", `start ffmpeg input=${micInput()} rate=${SAMPLE_RATE}`)
    child = Bun.spawn({
      cmd: ["ffmpeg", ...args],
      stdout: "pipe",
      stderr: "pipe",
    })
    if (!child.stdout || typeof child.stdout === "number") {
      throw new Error("ffmpeg mic capture failed to start")
    }
    reader = child.stdout.getReader()
    enabled = true
    void (async () => {
      if (child?.stderr && typeof child.stderr !== "number") {
        const stderr = await new Response(child.stderr).text()
        const message = stderr.trim()
        if (message && input.isRunning()) fail(`ffmpeg mic: ${message.split("\n").at(-1) ?? message}`)
      }
    })()
    void (async () => {
      while (input.isRunning() && reader) {
        const chunk = await reader.read()
        if (chunk.done) break
        if (!enabled) continue
        const bytes = chunk.value
        if (!bytes.byteLength) continue
        sentBytes += bytes.byteLength
        if (sentBytes === bytes.byteLength) {
          voiceLogStage("MIC", `pcm flowing (${bytes.byteLength} byte chunk)`)
        }
        input.sendPcm(Uint8Array.from(bytes).buffer)
      }
    })()
    void child.exited.then((code) => {
      if (code !== 0 && code !== null && input.isRunning()) {
        fail(`ffmpeg mic exited (${code}) — check Terminal microphone permission in System Settings`)
      }
    })
  }

  return { start, stop, setEnabled }
}
