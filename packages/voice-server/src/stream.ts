import { defaultHarnessRegistry, PERIODIC_INTERVAL_S, type HarnessAction } from "@opencode-ai/voice-harness"
import { emitHarnessActions, Speaker, type VoiceSender } from "./harness-actions"
import type { VoiceSession } from "./sessions"
import { SttError, XaiStreamingStt } from "./stt"
import { bestTranscript } from "./transcript"
import { clearLogContext, setLogContext, writeLog } from "./voice-log"

export type VoiceSocket = {
  send: (data: string | Uint8Array) => void | Promise<void>
  close: (code?: number, reason?: string) => void
  readyState: number
  binaryType?: BinaryType
  addEventListener: WebSocket["addEventListener"]
  removeEventListener: WebSocket["removeEventListener"]
  readInbound?: () => Promise<string | Uint8Array | undefined>
}

const OPEN = 1

function pcmFromMessage(data: unknown) {
  if (data instanceof Uint8Array) return data
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  return new Uint8Array()
}

export async function runVoiceStream(ws: VoiceSocket, voice: VoiceSession) {
  if (ws.binaryType !== "arraybuffer") ws.binaryType = "arraybuffer"
  const stt = new XaiStreamingStt()
  const registry = defaultHarnessRegistry
  registry.getOrCreate(voice.id)
  const transport = voice.composer ? "web" : "tui"
  setLogContext(voice.id, {
    voiceId: voice.id,
    sessionId: voice.opencodeSessionId,
    transport,
  })
  writeLog("STATE", `voice stream started transport=${transport}`, {
    voiceId: voice.id,
    sessionId: voice.opencodeSessionId,
    transport,
  })

  const sendJson = async (payload: Record<string, unknown>) => {
    if (ws.readyState !== OPEN) return
    await ws.send(JSON.stringify(payload))
  }

  const sender: VoiceSender = {
    sendJson,
    get open() {
      return ws.readyState === OPEN
    },
  }
  const speaker = new Speaker(sender, voice.id)
  const outbox: HarnessAction[] = []
  let outboxWait: (() => void) | undefined
  registry.bindOutbox(voice.id, (action: HarnessAction) => {
    outbox.push(action)
    outboxWait?.()
  })

  let actionQueue = Promise.resolve()
  const runActions = (actions: HarnessAction[]) => {
    actionQueue = actionQueue.then(() =>
      emitHarnessActions({ send: sender, speaker, actions, voiceId: voice.id }),
    )
    return actionQueue
  }

  await sendJson({
    type: "ready",
    voiceID: voice.id,
    opencodeSessionID: voice.opencodeSessionId,
    sampleRate: stt.sampleRate,
    encoding: "pcm16",
  })

  let acceptAudio = true
  let stopped = false
  let periodicBusy = false
  const stopPeriodic = startPeriodic(async () => {
    if (periodicBusy || speaker.speaking()) return
    periodicBusy = true
    try {
      const actions = await registry.periodicTick(voice.id)
      if (actions.length) await runActions(actions)
    } finally {
      periodicBusy = false
    }
  })

  const outboxLoop = (async () => {
    while (!stopped && ws.readyState === OPEN) {
      if (!outbox.length) {
        await new Promise<void>((resolve) => {
          outboxWait = resolve
        })
        outboxWait = undefined
        continue
      }
      const action = outbox.shift()
      if (action) await runActions([action])
    }
  })()

  try {
    while (!stopped && ws.readyState === OPEN) {
      await sendJson({ type: "status", state: "listening" })
      let text: string | null = null
      try {
        text = await listenOnce(ws, stt, () => acceptAudio)
      } catch (error) {
        const message = error instanceof SttError ? error.message : "stt error"
        writeLog("STT", message, { voiceId: voice.id })
        await sendJson({ type: "error", message })
        continue
      }
      if (!text) {
        await drain(ws, 150)
        writeLog("STATE", "no speech detected", { voiceId: voice.id })
        await sendJson({ type: "status", state: "idle", reason: "no speech" })
        continue
      }
      await drain(ws, 150)
      acceptAudio = false
      writeLog("STATE", `utterance final chars=${text.length}`, { voiceId: voice.id })
      await sendJson({ type: "status", state: "transcribing", text })
      const actions = await registry.routeUtterance(voice.id, text)
      await runActions(actions)
      acceptAudio = true
      await sendJson({ type: "status", state: "listening" })
    }
  } finally {
    stopped = true
    stopPeriodic()
    registry.unbindOutbox(voice.id)
    registry.drop(voice.id)
    clearLogContext(voice.id)
    outboxLoop.catch(() => {})
  }
}

function startPeriodic(tick: () => Promise<void>) {
  const timer = setInterval(() => {
    void tick()
  }, PERIODIC_INTERVAL_S * 1000)
  return () => clearInterval(timer)
}

async function listenOnce(ws: VoiceSocket, stt: XaiStreamingStt, acceptAudio: () => boolean) {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) {
      await sleep(500 * attempt)
      await sendWsJson(ws, { type: "status", state: "listening", retry: attempt + 1 })
    }
    let stopped = false
    const halt = () => {
      stopped = true
    }
    const frames = frameIterator(ws, () => stopped, acceptAudio, halt)
    try {
      const text = await transcribeFrames(stt, ws, frames, halt)
      if (text) return text
    } catch (error) {
      if (attempt < 2 && error instanceof SttError) continue
      throw error
    }
  }
  return null
}

async function sendWsJson(ws: VoiceSocket, payload: Record<string, unknown>) {
  if (ws.readyState !== OPEN) return
  await ws.send(JSON.stringify(payload))
}

async function transcribeFrames(
  stt: XaiStreamingStt,
  ws: VoiceSocket,
  frames: AsyncIterable<Uint8Array>,
  halt: () => void,
) {
  let captured = ""
  let stopped = false
  let utteranceClosed = false
  const committed: string[] = []
  const outbound: Array<Record<string, unknown>> = []
  let notify: (() => void) | undefined

  const flush = async () => {
    while (outbound.length) {
      const payload = outbound.shift()
      if (payload) await sendWsJson(ws, payload)
    }
  }

  const pump = (async () => {
    while (!stopped || outbound.length) {
      if (!outbound.length) {
        await new Promise<void>((resolve) => {
          notify = resolve
        })
        notify = undefined
        continue
      }
      await flush()
    }
  })()

  const noteTranscript = (full: string) => {
    const trimmed = full.trim()
    if (!trimmed || trimmed.length <= captured.length) return
    captured = trimmed
  }

  const onEvent = (event: Record<string, unknown>) => {
    if (event.type !== "transcript.partial") return
    const text = String(event.text ?? "").trim()
    const speechFinal = event.speech_final === true
    const isFinal = event.is_final === true
    if (isFinal && text) committed.push(text)
    const merged = bestTranscript(committed, text)
    if (speechFinal) {
      const before = captured.length
      noteTranscript(merged)
      const full = captured || merged
      if (!full) return
      if (!utteranceClosed) {
        outbound.push({ type: "transcript", text: full, final: true, speechFinal: true })
        utteranceClosed = true
        stopped = true
        halt()
      } else if (captured.length > before) {
        outbound.push({ type: "transcript", text: full, final: true, speechFinal: true })
      }
      notify?.()
      return
    }
    if (isFinal) {
      const display = bestTranscript(committed, "")
      outbound.push({
        type: "transcript",
        text: display,
        final: true,
        speechFinal: false,
      })
      notify?.()
      return
    }
    const display = merged || `${committed.join(" ")} ${text}`.trim()
    outbound.push({ type: "transcript", text: display, final: false, speechFinal: false })
    notify?.()
  }

  try {
    await stt.stream(frames, onEvent)
  } finally {
    stopped = true
    halt()
    notify?.()
    await pump
  }
  return captured.trim() || null
}

async function* frameIterator(
  ws: VoiceSocket,
  stopped: () => boolean,
  acceptAudio: () => boolean,
  halt: () => void,
) {
  if (ws.readInbound) {
    while (!stopped()) {
      const message = await ws.readInbound()
      if (message === undefined) return
      if (typeof message === "string") {
        try {
          const payload = JSON.parse(message) as Record<string, unknown>
          if (payload.type === "audio.done") halt()
        } catch {
          // ignore
        }
        continue
      }
      if (!acceptAudio()) continue
      const data = pcmFromMessage(message)
      if (data.byteLength) yield data
    }
    return
  }

  const queue: Uint8Array[] = []
  let wake: (() => void) | undefined

  const onMessage = (event: MessageEvent) => {
    if (stopped()) return
    if (typeof event.data === "string") {
      try {
        const payload = JSON.parse(event.data) as Record<string, unknown>
        if (payload.type === "audio.done") halt()
      } catch {
        // ignore
      }
      return
    }
    if (!acceptAudio()) return
    const data = pcmFromMessage(event.data)
    if (data.byteLength) {
      queue.push(data)
      wake?.()
    }
  }

  ws.addEventListener("message", onMessage)
  try {
    while (!stopped()) {
      if (queue.length) {
        yield queue.shift()!
        continue
      }
      await new Promise<void>((resolve) => {
        wake = resolve
      })
      wake = undefined
    }
  } finally {
    ws.removeEventListener("message", onMessage)
  }
}

async function drain(ws: VoiceSocket, ms: number) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline && ws.readyState === OPEN) {
    await sleep(50)
  }
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}
