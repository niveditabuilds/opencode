import { voiceLogStage } from "#log"
import { voiceSidecarBaseUrl } from "#play"

export type VoiceProgressSnapshot = {
  reads: number
  searches: number
  lists: number
  shell: number
  thinking: boolean
}

export type VoiceFinalSpeakPlan = {
  parts: string[]
  hasOffer: boolean
  fullText: string
  closingQuestion?: string | null
  actionOffer?: boolean
}

function resolveSidecarUrl(sidecarUrl?: string | (() => string)) {
  if (typeof sidecarUrl === "function") return sidecarUrl().replace(/\/+$/, "")
  return (sidecarUrl ?? voiceSidecarBaseUrl()).replace(/\/+$/, "")
}

async function postJson<T>(base: string, path: string, body: Record<string, unknown>): Promise<T> {
  const url = `${base}${path}`
  voiceLogStage("API", `POST ${path} body=${JSON.stringify(body).slice(0, 120)}`)
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (typeof globalThis.localStorage !== "undefined") headers["X-OpenCode-Voice-Log"] = "web"
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  })
  const raw = await res.text()
  let data: Record<string, unknown> = {}
  if (raw) {
    try {
      data = JSON.parse(raw) as Record<string, unknown>
    } catch {
      voiceLogStage("API", `${path} invalid JSON status=${res.status} raw=${raw.slice(0, 200)}`)
      throw new Error(`voice request invalid JSON (${res.status})`)
    }
  }
  if (!res.ok) {
    const message = typeof data.error === "string" ? data.error : `voice request failed (${res.status})`
    voiceLogStage("API", `${path} error status=${res.status} ${message}`)
    throw new Error(message)
  }
  const summary =
    path === "/voice/speak" && typeof data.data === "string"
      ? `format=${String(data.format)} b64=${data.data.length}`
      : path === "/voice/final-speak" && Array.isArray(data.parts)
        ? `parts=${data.parts.length}`
        : `keys=${Object.keys(data).join(",")}`
  voiceLogStage("API", `${path} ok ${summary}`)
  return data as T
}

export async function fetchVoiceFinalSpeak(input: { sidecarUrl?: string | (() => string); text: string }) {
  return postJson<VoiceFinalSpeakPlan>(resolveSidecarUrl(input.sidecarUrl), "/voice/final-speak", {
    text: input.text,
  })
}

export async function fetchVoiceSpeak(input: { sidecarUrl?: string | (() => string); text: string; raw?: boolean }) {
  return postJson<{ text: string; format: string; encoding: string; data: string }>(
    resolveSidecarUrl(input.sidecarUrl),
    "/voice/speak",
    { text: input.text, raw: input.raw ?? false },
  )
}

export async function postVoiceSessionUpdate(input: {
  sidecarUrl?: string | (() => string)
  voiceID: string
  payload: Record<string, unknown>
}) {
  return postJson<{ ok: boolean; actions?: unknown[] }>(
    resolveSidecarUrl(input.sidecarUrl),
    `/voice/session/${input.voiceID}/update`,
    input.payload,
  )
}
