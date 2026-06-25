import { spawn, type ChildProcess } from "node:child_process"
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
 * No Web Audio in the terminal, so buffer the streamed PCM and play it once at the end by
 * wrapping it in a WAV container. Not low-latency, but keeps terminal voice functional.
 */
export function createAudioSink(opts: { sampleRate: number }): AudioSink {
  const chunks: Uint8Array[] = []
  let stopped = false

  const push = (pcm: Uint8Array) => {
    if (!stopped) chunks.push(pcm)
  }

  const end = async () => {
    if (stopped) return
    const total = chunks.reduce((sum, c) => sum + c.byteLength, 0)
    if (!total) return
    const pcm = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      pcm.set(chunk, offset)
      offset += chunk.byteLength
    }
    const wav = wrapWav(pcm, opts.sampleRate)
    const file = join(tmpdir(), `opencode-voice-${Date.now()}.wav`)
    await writeFile(file, wav)
    try {
      await playFile(file)
    } finally {
      await unlink(file).catch(() => {})
    }
  }

  const stop = () => {
    stopped = true
    stopMp3()
  }

  return { push, end, stop }
}

function wrapWav(pcm: Uint8Array, sampleRate: number) {
  const header = new Uint8Array(44)
  const view = new DataView(header.buffer)
  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i))
  }
  const byteRate = sampleRate * 2
  writeStr(0, "RIFF")
  view.setUint32(4, 36 + pcm.byteLength, true)
  writeStr(8, "WAVE")
  writeStr(12, "fmt ")
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeStr(36, "data")
  view.setUint32(40, pcm.byteLength, true)
  const out = new Uint8Array(44 + pcm.byteLength)
  out.set(header, 0)
  out.set(pcm, 44)
  return out
}

export { voiceSidecarBaseUrl } from "#sidecar-url"
