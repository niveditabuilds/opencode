import { voiceLogStage } from "#log"

let audio: HTMLAudioElement | undefined

export function stopMp3() {
  if (!audio) return
  voiceLogStage("PLAY", "stop player")
  audio.pause()
  audio.removeAttribute("src")
  audio.onended = null
  audio.onerror = null
}

export type AudioSink = {
  push: (pcm: Uint8Array) => void
  end: () => Promise<void>
  stop: () => void
}

/**
 * Gapless streaming sink for raw PCM16 mono. Each pushed chunk is decoded to an
 * AudioBuffer and scheduled back-to-back on the AudioContext timeline, so audio plays
 * as it arrives without waiting for the full utterance.
 */
export function createAudioSink(opts: { sampleRate: number }): AudioSink {
  const Ctx: typeof AudioContext =
    (globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ??
    (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext!
  const ctx = new Ctx({ sampleRate: opts.sampleRate })
  void ctx.resume().catch(() => {})
  const sources = new Set<AudioBufferSourceNode>()
  let nextTime = 0
  let stopped = false
  let count = 0

  const push = (pcm: Uint8Array) => {
    if (stopped) return
    const frames = Math.floor(pcm.byteLength / 2)
    if (!frames) return
    const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength)
    const buffer = ctx.createBuffer(1, frames, opts.sampleRate)
    const channel = buffer.getChannelData(0)
    for (let i = 0; i < frames; i++) channel[i] = view.getInt16(i * 2, true) / 32768
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.connect(ctx.destination)
    const start = Math.max(ctx.currentTime + 0.02, nextTime)
    source.start(start)
    nextTime = start + buffer.duration
    sources.add(source)
    source.onended = () => sources.delete(source)
    count++
  }

  const end = () =>
    new Promise<void>((resolve) => {
      if (stopped) return resolve()
      voiceLogStage("PLAY", `stream end after ${count} chunks`)
      const remainingMs = Math.max(0, nextTime - ctx.currentTime) * 1000
      setTimeout(() => {
        if (!stopped) void ctx.close().catch(() => {})
        resolve()
      }, remainingMs + 60)
    })

  const stop = () => {
    if (stopped) return
    stopped = true
    voiceLogStage("PLAY", "stream stop")
    for (const source of sources) {
      try {
        source.stop()
      } catch {
        // already stopped
      }
    }
    sources.clear()
    void ctx.close().catch(() => {})
  }

  return { push, end, stop }
}

export async function playMp3(bytes: Uint8Array) {
  stopMp3()
  const blob = new Blob([Uint8Array.from(bytes)], { type: "audio/mpeg" })
  const url = URL.createObjectURL(blob)
  const element = audio ?? new Audio()
  audio = element
  element.setAttribute("playsinline", "true")
  voiceLogStage("PLAY", `play ${bytes.length} bytes`)
  try {
    element.src = url
    await element.play()
    await new Promise<void>((resolve, reject) => {
      element.onended = () => resolve()
      element.onerror = () => reject(new Error("playback failed"))
    })
    voiceLogStage("PLAY", "play done")
  } finally {
    element.removeAttribute("src")
    element.onended = null
    element.onerror = null
    URL.revokeObjectURL(url)
  }
}

export { voiceSidecarBaseUrl } from "#sidecar-url"
