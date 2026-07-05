import { resolve } from "node:path"
import { defaultHarnessRegistry } from "@opencode-ai/voice-harness"
import { planFinalSpeech, speakText } from "./speech-plan"
import { sessionJson, voiceSessions, type CreateSessionInput } from "./sessions"
import { XaiBatchTts } from "./tts"
import { requireXaiApiKey, SttError, TtsError, verifyXaiApiKey } from "./xai"
import {
  appendClientLogEntries,
  setLogContext,
  voxcodeLogPath,
  writeLog,
} from "./voice-log"

export { voxcodeLogPath } from "./voice-log"

export const VOICE_VERSION = "1.0.0"

function json(data: unknown, status = 200) {
  return Response.json(data, { status })
}

function badRequest(message: string) {
  return json({ error: message }, 400)
}

export async function voiceHealth() {
  const stt: Record<string, unknown> = { provider: "xai" }
  const tts: Record<string, unknown> = { provider: "xai" }
  let keyError: string | undefined
  try {
    requireXaiApiKey()
    stt.configured = true
    tts.configured = true
  } catch (error) {
    keyError = error instanceof SttError ? error.message : String(error)
    stt.configured = false
    tts.configured = false
    stt.error = keyError
    tts.error = keyError
  }
  if (!keyError) {
    try {
      await verifyXaiApiKey()
      stt.verified = true
      tts.verified = true
    } catch (error) {
      const message = error instanceof SttError ? error.message : String(error)
      stt.verified = false
      tts.verified = false
      stt.error = message
      tts.error = message
    }
  }
  return json({
    status: "ok",
    version: VOICE_VERSION,
    embedded: true,
    stt,
    tts,
    voxcodeLog: voxcodeLogPath(),
  })
}

export function voiceConfig(base: URL) {
  return json({
    protocol: 1,
    version: VOICE_VERSION,
    opencode_url: base.origin,
    routes: {
      health: "GET /voice/health",
      config: "GET /voice/config",
      session: "POST /voice/session",
      final_speak: "POST /voice/final-speak",
      update: "POST /voice/session/{voice_id}/update",
      log: "POST /voice/log",
      stream: "WSS /voice/session/{id}/stream",
    },
  })
}

function controlPlaneOrigin(body: CreateSessionInput, base: URL) {
  if (typeof body.server === "string" && body.server.trim()) return body.server.trim().replace(/\/+$/, "")
  return base.origin
}

export async function createVoiceSession(body: CreateSessionInput, base: URL) {
  if (!body.directory) return badRequest("directory is required")
  const sessionID = body.sessionID?.trim()
  if (!sessionID) return badRequest("sessionID is required")
  const directory = resolve(body.directory)
  const controlPlaneUrl = controlPlaneOrigin(body, base)
  const opencodeUrl = controlPlaneUrl
  const voice = voiceSessions.create({
    opencodeUrl,
    controlPlaneUrl,
    opencodeSessionId: sessionID,
    directory,
    agent: body.agent,
    composer: Boolean(body.composer),
  })
  defaultHarnessRegistry.create(voice.id)
  const transport = voice.composer ? "web" : "tui"
  setLogContext(voice.id, {
    voiceId: voice.id,
    sessionId: sessionID,
    transport,
  })
  const payload = sessionJson(voice)
  writeLog("STATE", `session created transport=${transport} stream=${payload.stream}`, {
    voiceId: voice.id,
    sessionId: sessionID,
    transport,
  })
  return json(payload, 201)
}

export async function voiceSessionUpdate(voiceId: string, body: Record<string, unknown>) {
  const voice = voiceSessions.get(voiceId)
  if (!voice) return json({ error: "voice session not found" }, 404)
  const harness = defaultHarnessRegistry.getOrCreate(voiceId)
  const transport = voice.composer ? "web" : "tui"
  setLogContext(voiceId, {
    voiceId,
    sessionId: voice.opencodeSessionId,
    turnId: harness.turnId,
    transport,
  })
  const event = String(body.event ?? "").trim().toLowerCase()
  if (event === "turn_complete") {
    const reply = String(body.reply ?? body.text ?? "")
    writeLog("HARNESS", `turn_complete received chars=${reply.trim().length}`, { voiceId })
  } else {
    writeLog("STATE", `harness update event=${event || "update"}`, { voiceId })
  }
  const actions = await defaultHarnessRegistry.applyUpdate(voiceId, body)
  if (event === "turn_complete") {
    const speak = actions.some((item) => item.action === "speak")
    writeLog("HARNESS", `turn_complete actions=${actions.length} speak=${speak}`, { voiceId })
  }
  return json({ ok: true, actions })
}

export function getVoiceSession(voiceId: string) {
  const voice = voiceSessions.get(voiceId)
  if (!voice) return json({ error: "voice session not found" }, 404)
  return json(sessionJson(voice))
}

export async function voiceFinalSpeak(body: Record<string, unknown>) {
  const text = String(body.text ?? "").trim()
  if (!text) return badRequest("text is required")
  writeLog("TTS", `final-speak plan ${text.length} chars`)
  return json(planFinalSpeech(text))
}

export async function voiceSpeak(body: Record<string, unknown>) {
  const text = String(body.text ?? "").trim()
  if (!text) return badRequest("text is required")
  const raw = Boolean(body.raw)
  const speak = raw ? text : speakText(text)
  if (!speak) return badRequest("nothing to speak")
  writeLog("TTS", `speak ${speak.length} chars raw=${raw}`)
  const tts = new XaiBatchTts()
  let audio: Uint8Array
  try {
    audio = await tts.synthesize(speak)
  } catch (error) {
    const message = error instanceof TtsError ? error.message : "tts failed"
    writeLog("TTS", `speak error ${message}`)
    return json({ error: message }, 502)
  }
  if (!audio.byteLength) {
    writeLog("TTS", "speak skipped: empty audio")
    return json({ error: "synthesis returned empty audio" }, 502)
  }
  writeLog("TTS", `speak ready ${speak.length} chars → ${audio.byteLength} bytes`)
  return json({
    text: speak,
    format: "mp3",
    encoding: "base64",
    data: bytesToBase64(audio),
  })
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = ""
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
  return btoa(binary)
}

export async function voiceClientLog(body: Record<string, unknown>) {
  const entries = body.entries
  if (Array.isArray(entries)) {
    const path = appendClientLogEntries(entries)
    return json({ ok: true, path, count: entries.length })
  }
  return badRequest("entries must be an array")
}

export function matchVoiceStreamPath(pathname: string) {
  const match = pathname.match(/^\/voice\/session\/([^/]+)\/stream$/)
  return match?.[1] ?? null
}

export function isVoicePath(pathname: string) {
  return pathname === "/voice/health" || pathname.startsWith("/voice/")
}

export async function handleVoiceHttp(request: Request): Promise<Response | null> {
  const url = new URL(request.url)
  if (!isVoicePath(url.pathname)) return null

  if (url.pathname === "/voice/health" && request.method === "GET") return voiceHealth()
  if (url.pathname === "/voice/config" && request.method === "GET") return voiceConfig(url)

  if (url.pathname === "/voice/session" && request.method === "POST") {
    const body = (await request.json().catch(() => null)) as CreateSessionInput | null
    if (!body || typeof body !== "object") return badRequest("request body must be JSON")
    return createVoiceSession(body, url)
  }

  if (url.pathname === "/voice/final-speak" && request.method === "POST") {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) return badRequest("request body must be JSON")
    return voiceFinalSpeak(body)
  }

  if (url.pathname === "/voice/speak" && request.method === "POST") {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) return badRequest("request body must be JSON")
    return voiceSpeak(body)
  }

  if (url.pathname === "/voice/log" && request.method === "POST") {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) return badRequest("request body must be JSON")
    return voiceClientLog(body)
  }

  const updateMatch = url.pathname.match(/^\/voice\/session\/([^/]+)\/update$/)
  if (updateMatch && request.method === "POST") {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) return badRequest("request body must be JSON")
    return voiceSessionUpdate(updateMatch[1]!, body)
  }

  const sessionMatch = url.pathname.match(/^\/voice\/session\/([^/]+)$/)
  if (sessionMatch && request.method === "GET") return getVoiceSession(sessionMatch[1]!)

  return json({ error: "not found" }, 404)
}
