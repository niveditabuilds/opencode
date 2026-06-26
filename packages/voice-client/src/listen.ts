import { createMicCapture, type MicCapture } from "#mic"
import { parseVoiceSidecarEvent } from "./sidecar"
import { voiceStreamUrl } from "./url"

export type VoiceStreamTransport = {
  attach: (stream: string) => Promise<void>
  close: () => void
  setMicEnabled: (enabled: boolean) => void
  stopMic: () => void
  startMic: () => Promise<void>
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
  createSession: (params: ConnectParams) => Promise<{ id: string; stream: string }>
}): VoiceStreamTransport {
  let ws: WebSocket | undefined
  let reconnecting = false
  let mic: MicCapture | undefined
  let connectParams: ConnectParams | undefined

  const isOpen = () => ws?.readyState === WebSocket.OPEN

  const sendPcm = (buffer: ArrayBuffer) => {
    if (!input.isRunning() || !ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(buffer)
  }

  const setMicEnabled = (enabled: boolean) => {
    mic?.setEnabled(enabled && input.isRunning())
  }

  const stopMic = () => {
    mic?.stop()
    mic = undefined
  }

  const startMic = async () => {
    stopMic()
    mic = createMicCapture({
      sendPcm,
      isRunning: input.isRunning,
      onError: input.onError,
    })
    await mic.start()
    mic.setEnabled(true)
  }

  const attach = (stream: string) =>
    new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(stream)
      ws = socket
      socket.binaryType = "arraybuffer"
      socket.onopen = () => {
        input.onOpen()
        resolve()
      }
      socket.onerror = () => reject(new Error(`voice stream connection failed (${stream})`))
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
            stopMic()
          })
          .catch(() => {
            reconnecting = false
            input.onError("voice stream closed — toggle voice off and on")
            stopMic()
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
      await attach(voiceStreamUrl(connectParams.sidecarUrl, session.id))
      return ws?.readyState === WebSocket.OPEN
    } catch {
      return false
    }
  }

  const close = () => {
    stopMic()
    if (ws && ws.readyState === WebSocket.OPEN) ws.close()
    ws = undefined
  }

  return {
    attach,
    close,
    setMicEnabled,
    stopMic,
    startMic,
    ensureConnected,
    setConnectParams: (params) => {
      connectParams = params
    },
    isOpen,
  }
}
