import { downsampleTo16k } from "./audio"
import { SILENT_WAV } from "./types"

export type MicCapture = {
  start: () => Promise<void>
  stop: () => void
  setEnabled: (enabled: boolean) => void
}

export function createMicCapture(input: {
  sendPcm: (buffer: ArrayBuffer) => void
  isRunning: () => boolean
  onError?: (message: string) => void
}): MicCapture {
  let enabled = false
  let audioContext: AudioContext | undefined
  let processor: ScriptProcessorNode | undefined
  let source: MediaStreamAudioSourceNode | undefined
  let mediaStream: MediaStream | undefined
  let unlockAudio: HTMLAudioElement | undefined

  const stop = () => {
    enabled = false
    processor?.disconnect()
    source?.disconnect()
    if (audioContext) void audioContext.close()
    mediaStream?.getTracks().forEach((track) => track.stop())
    processor = undefined
    source = undefined
    audioContext = undefined
    mediaStream = undefined
    unlockAudio = undefined
  }

  const setEnabled = (value: boolean) => {
    enabled = value && input.isRunning()
  }

  const start = async () => {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    })
    audioContext = new AudioContext()
    if (audioContext.state === "suspended") await audioContext.resume()
    unlockAudio = new Audio()
    unlockAudio.setAttribute("playsinline", "true")
    unlockAudio.src = SILENT_WAV
    try {
      await unlockAudio.play()
      unlockAudio.pause()
      unlockAudio.removeAttribute("src")
    } catch {
      // Browser may still allow later playback after further interaction.
    }
    source = audioContext.createMediaStreamSource(mediaStream)
    processor = audioContext.createScriptProcessor(4096, 1, 1)
    processor.onaudioprocess = (event) => {
      if (!enabled || !input.isRunning()) return
      const pcm = downsampleTo16k(event.inputBuffer.getChannelData(0), audioContext!.sampleRate)
      input.sendPcm(pcm.buffer)
    }
    source.connect(processor)
    const silent = audioContext.createGain()
    silent.gain.value = 0
    processor.connect(silent)
    silent.connect(audioContext.destination)
    enabled = true
  }

  return { start, stop, setEnabled }
}
