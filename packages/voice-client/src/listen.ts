import { downsampleTo16k } from "./audio"
import { parseVoiceSidecarEvent } from "./sidecar"
import { SILENT_WAV } from "./types"

export type VoiceStreamTransport = {
  attach: (stream: string) => Promise<void>
  close: () => void
  setMicEnabled: (enabled: boolean) => void
  stopBrowserMic: () => void
  startBrowserMic: () => Promise<void>
  ensureConnected: () => Promise<boolean>
  setConnectParams: (params: ConnectParams | undefined) => void
  isOpen: () => boolean
}

export type ConnectParams = {
  sidecarUrl: string
  directory: string
  sessionID: string
  agent: string | undefined
  server: string
}

export function createVoiceStreamTransport(input: {
  transport: "terminal" | "browser"
  onEvent: (event: ReturnType<typeof parseVoiceSidecarEvent>) => void
  onError: (message: string) => void
  onOpen: () => void
  onTerminalClose: () => void
  isRunning: () => boolean
  createSession: (params: ConnectParams) => Promise<{ stream: string }>
}): VoiceStreamTransport {
  let ws: WebSocket | undefined
  let sendAudio = false
  let reconnecting = false
  let audioContext: AudioContext | undefined
  let processor: ScriptProcessorNode | undefined
  let source: MediaStreamAudioSourceNode | undefined
  let mediaStream: MediaStream | undefined
  let unlockAudio: HTMLAudioElement | undefined
  let connectParams: ConnectParams | undefined

  const isOpen = () => ws?.readyState === WebSocket.OPEN

  const setMicEnabled = (enabled: boolean) => {
    if (input.transport === "browser") {
      sendAudio = enabled && input.isRunning()
      return
    }
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({ type: "mic", enabled }))
  }

  const stopBrowserMic = () => {
    sendAudio = false
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

  const startBrowserMic = async () => {
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
      if (!input.isRunning() || !sendAudio || !ws || ws.readyState !== WebSocket.OPEN) return
      const pcm = downsampleTo16k(event.inputBuffer.getChannelData(0), audioContext!.sampleRate)
      ws.send(pcm.buffer)
    }
    source.connect(processor)
    const silent = audioContext.createGain()
    silent.gain.value = 0
    processor.connect(silent)
    silent.connect(audioContext.destination)
    sendAudio = true
  }

  const attach = (stream: string) =>
    new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(stream)
      ws = socket
      if (input.transport === "browser") socket.binaryType = "arraybuffer"
      socket.onopen = () => {
        input.onOpen()
        resolve()
      }
      socket.onerror = () => reject(new Error("voice stream connection failed"))
      socket.onmessage = (message) => {
        if (typeof message.data !== "string") return
        input.onEvent(parseVoiceSidecarEvent(message.data))
      }
      socket.onclose = () => {
        if (!input.isRunning()) return
        if (input.transport !== "browser") {
          input.onError("voice stream closed")
          input.onTerminalClose()
          return
        }
        if (reconnecting) return
        reconnecting = true
        void ensureConnected()
          .then((ok) => {
            reconnecting = false
            if (ok) return
            input.onError("voice stream closed — toggle voice off and on")
            stopBrowserMic()
          })
          .catch(() => {
            reconnecting = false
            input.onError("voice stream closed — toggle voice off and on")
            stopBrowserMic()
          })
      }
    })

  const ensureConnected = async () => {
    if (ws?.readyState === WebSocket.OPEN) return true
    if (!input.isRunning() || !connectParams) return false
    if (ws && ws.readyState !== WebSocket.CLOSED) {
      ws.close()
      ws = undefined
    }
    try {
      const session = await input.createSession(connectParams)
      await attach(session.stream)
      return ws?.readyState === WebSocket.OPEN
    } catch {
      return false
    }
  }

  const close = () => {
    if (input.transport === "browser") stopBrowserMic()
    if (ws && ws.readyState === WebSocket.OPEN) {
      if (input.transport === "terminal") setMicEnabled(false)
      ws.close()
    }
    ws = undefined
  }

  return {
    attach,
    close,
    setMicEnabled,
    stopBrowserMic,
    startBrowserMic,
    ensureConnected,
    setConnectParams: (params) => {
      connectParams = params
    },
    isOpen,
  }
}
