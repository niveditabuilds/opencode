import {
  buildVoiceLogEntry,
  formatVoiceLogLine,
  type VoiceLogEntry,
  type VoiceLogStage,
} from "./log-core"
import { voiceAuthHeaders } from "./auth"

export {
  clearVoiceLogContext,
  setVoiceLogContext,
  voiceLogContext,
  type VoiceLogContext,
  type VoiceLogEntry,
  type VoiceLogStage,
  type VoiceLogTransport,
} from "./log-core"

export function voiceLogPath() {
  return "~/.voxcode/logs.jsonl"
}

const MAX_LINES = 800

const buffer: string[] = []
let pending: VoiceLogEntry[] = []
let flushScheduled = false
let sidecarUrl: (() => string) | undefined
let voiceAuth: (() => import("./auth").VoiceAuth | undefined) | undefined
let enabled = true
let listener: ((line: string) => void) | undefined
let lastLine = ""

function debugEnabled() {
  if (typeof localStorage === "undefined") return false
  return localStorage.getItem("opencode.voice.debug") === "1"
}

function queueFlush(entry: VoiceLogEntry) {
  if (!enabled) return
  pending.push(entry)
  if (flushScheduled) return
  flushScheduled = true
  queueMicrotask(() => {
    flushScheduled = false
    void flushPending()
  })
}

let flushWarned = false

function warnFlushOnce(message: string) {
  if (flushWarned) return
  flushWarned = true
  console.warn(`voice log: ${message}`)
}

async function flushPending() {
  const entries = pending.splice(0)
  if (!entries.length) return
  if (!sidecarUrl) {
    warnFlushOnce("sidecar URL not configured — toggle voice off and on after sidecar starts")
    pending.unshift(...entries)
    return
  }
  const base = sidecarUrl().replace(/\/+$/, "")
  try {
    const res = await fetch(`${base}/voice/log`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-OpenCode-Voice-Log": "web",
        ...voiceAuthHeaders(voiceAuth?.()),
      },
      keepalive: true,
      body: JSON.stringify({ entries }),
    })
    if (!res.ok) {
      warnFlushOnce(`POST /voice/log failed (${res.status}) — is the opencode server running?`)
      pending.unshift(...entries)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "fetch failed"
    warnFlushOnce(`POST /voice/log error (${message}) — is the opencode server running?`)
    pending.unshift(...entries)
  }
}

export function initVoiceLog(input?: {
  sidecarUrl?: () => string
  voiceAuth?: () => import("./auth").VoiceAuth | undefined
  active?: () => boolean
}) {
  sidecarUrl = input?.sidecarUrl
  voiceAuth = input?.voiceAuth
  if (input?.active) enabled = input.active()
}

export function setVoiceLogEnabled(active: boolean) {
  enabled = active
  if (!active) {
    pending = []
    flushScheduled = false
    return
  }
  flushWarned = false
}

export function voiceLogLast() {
  return lastLine
}

export function setVoiceLogListener(fn: ((line: string) => void) | undefined) {
  listener = fn
}

export function voiceLogEntry(entry: VoiceLogEntry) {
  if (!enabled) return
  const line = formatVoiceLogLine(entry)
  lastLine = line
  buffer.push(line)
  if (buffer.length > MAX_LINES) buffer.shift()
  listener?.(line)
  if (debugEnabled()) console.debug(`voice ${line}`)
  queueFlush(entry)
}

export function voiceLog(message: string) {
  voiceLogStage("STATE", message.replace(/^\[[^\]]+\]\s*/, ""))
}

export function voiceLogLines() {
  return [...buffer]
}

export function voiceLogStage(stage: VoiceLogStage | string, message: string) {
  voiceLogEntry(buildVoiceLogEntry(stage, message))
}

export function voiceLogOnce(key: string, message: string) {
  if (voiceLogOnce.seen.has(key)) return
  voiceLogOnce.seen.add(key)
  voiceLog(message)
}

voiceLogOnce.seen = new Set<string>()

export function voiceLogResetOnce() {
  voiceLogOnce.seen.clear()
}
