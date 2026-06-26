import { appendFileSync, mkdirSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import {
  buildVoiceLogEntry,
  formatVoiceLogLine,
  type VoiceLogEntry,
  type VoiceLogStage,
} from "./log-core"

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
  return join(homedir(), ".voxcode", "logs.jsonl")
}

let listener: ((line: string) => void) | undefined
let lastLine = ""

export function voiceLogLast() {
  return lastLine
}

export function setVoiceLogListener(fn: ((line: string) => void) | undefined) {
  listener = fn
}

function appendEntry(entry: VoiceLogEntry) {
  mkdirSync(dirname(voiceLogPath()), { recursive: true })
  appendFileSync(voiceLogPath(), `${JSON.stringify(entry)}\n`)
}

export function voiceLogEntry(entry: VoiceLogEntry) {
  const line = formatVoiceLogLine(entry)
  lastLine = line
  appendEntry(entry)
  listener?.(line)
  if (process.env.VOICE_DEBUG === "1") process.stderr.write(`voice: ${line}\n`)
}

export function voiceLog(message: string) {
  voiceLogStage("STATE", message.replace(/^\[[^\]]+\]\s*/, ""))
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

export function initVoiceLog(_input?: { sidecarUrl?: () => string; active?: () => boolean }) {}

export function setVoiceLogEnabled(_active: boolean) {}

export function voiceLogLines() {
  return [] as string[]
}
