import { appendFileSync, mkdirSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

export type VoiceLogContext = {
  voiceId?: string
  sessionId?: string
  turnId?: number
  transport?: "tui" | "web"
}

export type VoiceLogEntry = {
  ts: string
  source: "client" | "sidecar" | "voxcode"
  stage: string
  message: string
  transport?: "tui" | "web"
  voiceId?: string
  sessionId?: string
  turnId?: number
}

const globalKey = "__global__"
const contextByVoice = new Map<string, VoiceLogContext>()

export function voxcodeLogPath() {
  return join(homedir(), ".voxcode", "logs.jsonl")
}

export function ensureVoxcodeLog() {
  const path = voxcodeLogPath()
  mkdirSync(dirname(path), { recursive: true })
  return path
}

export function setLogContext(voiceId: string | undefined, patch: VoiceLogContext) {
  const key = voiceId ?? globalKey
  const current = { ...contextByVoice.get(key), ...patch }
  for (const name of Object.keys(current) as (keyof VoiceLogContext)[]) {
    if (current[name] === undefined) delete current[name]
  }
  contextByVoice.set(key, current)
}

export function clearLogContext(voiceId?: string) {
  contextByVoice.delete(voiceId ?? globalKey)
}

function resolveContext(voiceId?: string) {
  const merged: VoiceLogContext = { ...contextByVoice.get(globalKey) }
  if (voiceId) Object.assign(merged, contextByVoice.get(voiceId))
  return merged
}

export function writeLog(
  stage: string,
  message: string,
  input?: {
    source?: VoiceLogEntry["source"]
    voiceId?: string
    sessionId?: string
    turnId?: number
    transport?: "tui" | "web"
    extra?: Record<string, unknown>
  },
) {
  const ctx = resolveContext(input?.voiceId)
  const entry: VoiceLogEntry = {
    ts: new Date().toISOString(),
    source: input?.source ?? "sidecar",
    stage,
    message,
  }
  const transport = input?.transport ?? ctx.transport
  const voiceId = input?.voiceId ?? ctx.voiceId
  const sessionId = input?.sessionId ?? ctx.sessionId
  const turnId = input?.turnId ?? ctx.turnId
  if (transport) entry.transport = transport
  if (voiceId) entry.voiceId = voiceId
  if (sessionId) entry.sessionId = sessionId
  if (turnId !== undefined) entry.turnId = turnId
  if (input?.extra) Object.assign(entry, input.extra)
  appendEntries([entry])
}

export function appendEntries(entries: VoiceLogEntry[]) {
  if (!entries.length) return voxcodeLogPath()
  const path = ensureVoxcodeLog()
  for (const entry of entries) {
    appendFileSync(path, `${JSON.stringify(entry)}\n`)
  }
  return path
}

export function formatLogLine(entry: VoiceLogEntry) {
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

export function appendClientLogEntries(entries: unknown[]) {
  const normalized: VoiceLogEntry[] = []
  for (const item of entries) {
    if (!item || typeof item !== "object") continue
    const raw = item as Record<string, unknown>
    const stage = typeof raw.stage === "string" ? raw.stage : "STATE"
    const message = typeof raw.message === "string" ? raw.message : ""
    if (!message.trim()) continue
    normalized.push({
      ts: typeof raw.ts === "string" ? raw.ts : new Date().toISOString(),
      source: raw.source === "client" || raw.source === "voxcode" ? raw.source : "client",
      stage,
      message,
      ...(typeof raw.transport === "string" && (raw.transport === "tui" || raw.transport === "web")
        ? { transport: raw.transport }
        : {}),
      ...(typeof raw.voiceId === "string" ? { voiceId: raw.voiceId } : {}),
      ...(typeof raw.sessionId === "string" ? { sessionId: raw.sessionId } : {}),
      ...(typeof raw.turnId === "number" ? { turnId: raw.turnId } : {}),
    })
  }
  return appendEntries(normalized)
}
