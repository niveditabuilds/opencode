import { requireXaiApiKey, SttError, STT_SAMPLE_RATE, xaiWsBase } from "./xai"
import { authorizedWebSocket } from "./ws"

export { SttError } from "./xai"

export type SttEvent = Record<string, unknown>

export class XaiStreamingStt {
  sampleRate = STT_SAMPLE_RATE
  #url: string
  #apiKey: string

  constructor() {
    this.#apiKey = requireXaiApiKey()
    const language = process.env.VOICE_STT_LANGUAGE ?? "en"
    const query = new URLSearchParams({
      sample_rate: String(STT_SAMPLE_RATE),
      encoding: "pcm",
      interim_results: "true",
      language,
    })
    // End-of-turn detection. xAI's fixed `endpointing` (default 10ms) finalizes the utterance on
    // the slightest pause between words, so partials never stream and short phrases get cut. Use
    // Smart Turn instead: an ML model decides at each silence boundary whether the speaker actually
    // finished a thought (otherwise the event is demoted to chunk_final and we keep listening),
    // with a timeout as a safety cap so the turn always closes after a real pause.
    const smartTurn = process.env.VOICE_STT_SMART_TURN ?? "0.7"
    const smartTurnTimeout = process.env.VOICE_STT_SMART_TURN_TIMEOUT_MS ?? "2000"
    query.set("smart_turn", smartTurn)
    query.set("smart_turn_timeout", smartTurnTimeout)
    this.#url = `${xaiWsBase()}/stt?${query}`
  }

  async stream(frames: AsyncIterable<Uint8Array>, onEvent: (event: SttEvent) => void) {
    const ws = authorizedWebSocket(this.#url, this.#apiKey)
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve(), { once: true })
      ws.addEventListener("error", () => reject(new SttError("WebSocket connection failed")), { once: true })
    })
    const created = JSON.parse(String(await waitMessage(ws))) as SttEvent
    if (created.type !== "transcript.created") throw new SttError(`unexpected first message: ${JSON.stringify(created)}`)

    let done = false
    const sender = (async () => {
      for await (const chunk of frames) {
        if (done || ws.readyState !== WebSocket.OPEN) break
        ws.send(chunk)
      }
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "audio.done" }))
    })()

    try {
      while (ws.readyState === WebSocket.OPEN) {
        const raw = await waitMessage(ws)
        if (typeof raw !== "string") continue
        const event = JSON.parse(raw) as SttEvent
        if (event.type === "error") throw new SttError(String(event.message ?? "stream error"))
        onEvent(event)
        if (event.type === "transcript.done") break
      }
    } finally {
      done = true
      sender.catch(() => {})
      ws.close()
    }
  }
}

function waitMessage(ws: WebSocket) {
  return new Promise<string | ArrayBuffer>((resolve, reject) => {
    const onMessage = (event: MessageEvent) => {
      cleanup()
      resolve(event.data as string | ArrayBuffer)
    }
    const onError = () => {
      cleanup()
      reject(new SttError("WebSocket connection failed"))
    }
    const onClose = () => {
      cleanup()
      reject(new SttError("WebSocket closed"))
    }
    const cleanup = () => {
      ws.removeEventListener("message", onMessage)
      ws.removeEventListener("error", onError)
      ws.removeEventListener("close", onClose)
    }
    ws.addEventListener("message", onMessage)
    ws.addEventListener("error", onError)
    ws.addEventListener("close", onClose)
  })
}
