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
