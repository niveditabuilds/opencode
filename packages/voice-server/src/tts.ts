import { requireXaiApiKey, TtsError, xaiBaseUrl, xaiWsBase } from "./xai"
import { authorizedWebSocket } from "./ws"

export class XaiBatchTts {
  #apiKey: string
  #baseUrl: string
  #voiceId: string
  #language: string

  constructor() {
    this.#apiKey = requireXaiApiKey()
    this.#baseUrl = xaiBaseUrl()
    this.#voiceId = process.env.VOICE_TTS_VOICE ?? "eve"
    this.#language = process.env.VOICE_TTS_LANGUAGE ?? "en"
  }

  async synthesize(text: string) {
    const stripped = text.trim()
    if (!stripped) return new Uint8Array()
    const res = await fetch(`${this.#baseUrl}/tts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.#apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: stripped.slice(0, 15000),
        voice_id: this.#voiceId,
        language: this.#language,
      }),
    })
    if (!res.ok) throw new TtsError(`TTS API error ${res.status}: ${(await res.text()).slice(0, 300)}`)
    return new Uint8Array(await res.arrayBuffer())
  }
}

const MAX_DELTA_CHARS = 400

export class XaiTtsStream {
  sampleRate = 24_000
  #url: string
  #apiKey: string

  constructor() {
    this.#apiKey = requireXaiApiKey()
    const query = new URLSearchParams({
      language: process.env.VOICE_TTS_LANGUAGE ?? "en",
      voice: process.env.VOICE_TTS_VOICE ?? "eve",
      codec: "pcm",
      sample_rate: String(this.sampleRate),
    })
    this.#url = `${xaiWsBase()}/tts?${query}`
  }

  async *synthesize(text: string, shouldContinue: () => boolean) {
    const chunks = chunkText(text)
    if (!chunks.length) return
    const ws = authorizedWebSocket(this.#url, this.#apiKey)
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve(), { once: true })
      ws.addEventListener("error", () => reject(new TtsError("TTS stream connection failed")), { once: true })
    })
    try {
      for (const chunk of chunks) {
        ws.send(JSON.stringify({ type: "text.delta", delta: chunk }))
      }
      ws.send(JSON.stringify({ type: "text.done" }))
      while (ws.readyState === WebSocket.OPEN) {
        const raw = await waitMessage(ws)
        if (typeof raw !== "string") continue
        const event = JSON.parse(raw) as Record<string, unknown>
        const kind = event.type
        if (kind === "audio.delta") {
          if (!shouldContinue()) {
            ws.send(JSON.stringify({ type: "text.clear" }))
            return
          }
          const delta = typeof event.delta === "string" ? event.delta : ""
          if (!delta) continue
          yield Uint8Array.from(atob(delta), (c) => c.charCodeAt(0))
        }
        if (kind === "audio.done" || kind === "audio.clear") return
        if (kind === "error") throw new TtsError(String(event.message ?? "tts stream error"))
      }
    } finally {
      ws.close()
    }
  }
}

function chunkText(text: string) {
  const stripped = text.trim()
  if (!stripped) return [] as string[]
  const chunks: string[] = []
  let current = ""
  for (const token of splitSentences(stripped)) {
    if (current && current.length + token.length > MAX_DELTA_CHARS) {
      chunks.push(current)
      current = token
    } else {
      current = current ? `${current} ${token}`.trim() : token
    }
  }
  if (current) chunks.push(current)
  return chunks
}

function splitSentences(text: string) {
  const out: string[] = []
  let buf = ""
  for (const ch of text) {
    buf += ch
    if (".!?".includes(ch) && buf.trim().length > 1) {
      out.push(buf.trim())
      buf = ""
    }
  }
  if (buf.trim()) out.push(buf.trim())
  return out
}

function waitMessage(ws: WebSocket) {
  return new Promise<string | ArrayBuffer>((resolve, reject) => {
    const onMessage = (event: MessageEvent) => {
      cleanup()
      resolve(event.data as string | ArrayBuffer)
    }
    const onError = () => {
      cleanup()
      reject(new TtsError("TTS stream connection failed"))
    }
    const cleanup = () => {
      ws.removeEventListener("message", onMessage)
      ws.removeEventListener("error", onError)
    }
    ws.addEventListener("message", onMessage)
    ws.addEventListener("error", onError)
  })
}
