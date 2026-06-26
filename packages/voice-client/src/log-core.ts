export type VoiceLogStage = "REPLY" | "TTS" | "API" | "PLAY" | "STATE" | "RUNTIME" | "HARNESS"

export type VoiceLogTransport = "tui" | "web"

export type VoiceLogContext = {
  transport?: VoiceLogTransport
  voiceId?: string
  sessionId?: string
  turnId?: number
}

export type VoiceLogEntry = {
  ts: string
  source: "client" | "sidecar" | "voxcode"
  stage: VoiceLogStage | string
  message: string
  transport?: VoiceLogTransport
  voiceId?: string
  sessionId?: string
  turnId?: number
}

let context: VoiceLogContext = {}

export function voiceLogContext() {
  return { ...context }
}

export function setVoiceLogContext(patch: VoiceLogContext) {
  context = { ...context, ...patch }
}

export function clearVoiceLogContext(keys?: (keyof VoiceLogContext)[]) {
  if (!keys) {
    context = {}
    return
  }
  for (const key of keys) delete context[key]
}

export function buildVoiceLogEntry(stage: VoiceLogStage | string, message: string): VoiceLogEntry {
  return {
    ts: new Date().toISOString(),
    source: "client",
    stage,
    message,
    ...(context.transport ? { transport: context.transport } : {}),
    ...(context.voiceId ? { voiceId: context.voiceId } : {}),
    ...(context.sessionId ? { sessionId: context.sessionId } : {}),
    ...(context.turnId !== undefined ? { turnId: context.turnId } : {}),
  }
}

export function formatVoiceLogLine(entry: VoiceLogEntry) {
  const time = entry.ts.slice(11, 23)
  const ids = [
    entry.voiceId ? `v:${entry.voiceId.slice(-8)}` : "",
    entry.sessionId ? `s:${entry.sessionId.slice(-8)}` : "",
    entry.turnId !== undefined ? `t:${entry.turnId}` : "",
  ]
    .filter(Boolean)
    .join(" ")
  const prefix = ids ? `${ids} ` : ""
  return `${time} ${prefix}[${entry.stage}] ${entry.message}`
}
