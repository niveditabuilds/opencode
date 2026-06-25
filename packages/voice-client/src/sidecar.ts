import { voiceSidecarBaseUrl } from "#play"

export type VoiceHarnessAction =
  | "submit_turn"
  | "redirect"
  | "interrupt"
  | "speak"
  | "set_phase"
  | "expect_reply"
  | "clear_expect_reply"
  | "trace"

export type VoiceSidecarEvent =
  | { type: "ready"; voiceID: string; opencodeSessionID: string; sampleRate: number; encoding: string }
  | { type: "status"; state: string; text?: string; reason?: string; retry?: number }
  | { type: "transcript"; text: string; final: boolean; speechFinal: boolean }
  | { type: "reply"; text: string }
  | { type: "tts"; format: string; encoding: string; data: string }
  | { type: "speak"; skipped?: boolean }
  | { type: "action"; action: VoiceHarnessAction; text?: string; phase?: string; raw?: boolean; trigger?: string }
  | { type: "audio.start"; trigger?: string; sampleRate?: number; codec?: string }
  | { type: "audio.delta"; data: string }
  | { type: "audio.end" }
  | { type: "audio.error"; message: string }
  | { type: "error"; message: string }

export type VoiceSessionInfo = {
  id: string
  stream: string
}

function resolveSidecarUrl(sidecarUrl?: string | (() => string)) {
  if (typeof sidecarUrl === "function") return sidecarUrl().replace(/\/+$/, "")
  return (sidecarUrl ?? voiceSidecarBaseUrl()).replace(/\/+$/, "")
}

export async function createVoiceSidecarSession(input: {
  sidecarUrl?: string | (() => string)
  directory: string
  sessionID?: string
  agent?: string
  server?: string
  terminalMic?: boolean
  composer?: boolean
}): Promise<VoiceSessionInfo> {
  const base = resolveSidecarUrl(input.sidecarUrl)
  const res = await fetch(`${base}/voice/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      directory: input.directory,
      sessionID: input.sessionID,
      agent: input.agent,
      server: input.server,
      composer: input.composer ?? !input.terminalMic,
      terminalMic: input.terminalMic ?? false,
    }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const message = typeof data.error === "string" ? data.error : `voice session failed (${res.status})`
    throw new Error(message)
  }
  return data as VoiceSessionInfo
}

function speechFinal(event: { speechFinal?: boolean; speech_final?: boolean }) {
  return event.speechFinal === true || event.speech_final === true
}

export function parseVoiceSidecarEvent(raw: string): VoiceSidecarEvent | undefined {
  try {
    const event = JSON.parse(raw) as VoiceSidecarEvent & { speech_final?: boolean }
    if (event.type === "transcript") {
      return {
        ...event,
        speechFinal: speechFinal(event),
      }
    }
    return event
  } catch {
    return undefined
  }
}
