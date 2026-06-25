/** TTS output — sidecar HTTP + local playback. Not coupled to STT or WSS session. */

import { fetchVoiceFinalSpeak, fetchVoiceSpeak, type VoiceFinalSpeakPlan } from "./api"
import { voiceLogStage } from "#log"
import { playMp3, voiceSidecarBaseUrl } from "#play"
import { clearVoiceReplyArmed, noteVoiceAction, setVoiceOutput } from "./store"

export function base64ToBytes(data: string) {
  const binary = atob(data)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export type SpeakTextInput = {
  sidecarUrl?: string | (() => string)
  text: string
  raw?: boolean
  audioBytes?: Uint8Array
  shouldContinue?: () => boolean
}

export async function speakText(input: SpeakTextInput) {
  const text = input.text.trim()
  if (!text) return
  voiceLogStage("TTS", `fetch ${text.length} chars raw=${input.raw ?? false}`)
  const bytes =
    input.audioBytes ??
    base64ToBytes((await fetchVoiceSpeak({ sidecarUrl: input.sidecarUrl, text, raw: input.raw ?? false })).data)
  if (input.shouldContinue && !input.shouldContinue()) {
    voiceLogStage("TTS", "abort stale generation after fetch")
    return
  }
  voiceLogStage("TTS", `play ${bytes.length} bytes format=mp3`)
  await playMp3(bytes)
  voiceLogStage("TTS", "play done")
}

export type SpeakPartsInput = {
  sidecarUrl?: string | (() => string)
  parts: string[]
  raw?: boolean
  shouldContinue?: () => boolean
  resolveAudioBytes?: (text: string, index: number) => Uint8Array | undefined
  onPartStart?: (text: string, index: number) => void
}

export async function speakParts(input: SpeakPartsInput) {
  for (let index = 0; index < input.parts.length; index++) {
    if (input.shouldContinue && !input.shouldContinue()) return false
    const text = input.parts[index]
    if (!text?.trim()) continue
    input.onPartStart?.(text, index)
    await speakText({
      sidecarUrl: input.sidecarUrl,
      text,
      raw: input.raw,
      audioBytes: input.resolveAudioBytes?.(text, index),
      shouldContinue: input.shouldContinue,
    })
    if (input.shouldContinue && !input.shouldContinue()) return false
  }
  return true
}

export type SpeakAssistantReplyInput = {
  sidecarUrl?: string | (() => string)
  reply: string
  raw?: boolean
  shouldContinue?: () => boolean
  resolveAudioBytes?: (text: string, index: number) => Uint8Array | undefined
  onPartStart?: (text: string, index: number) => void
  clearArmedOnDone?: boolean
}

export async function speakAssistantReply(input: SpeakAssistantReplyInput): Promise<VoiceFinalSpeakPlan> {
  const reply = input.reply.trim()
  if (!reply) throw new Error("empty reply")
  setVoiceOutput("speaking", true)
  noteVoiceAction(`reply-start ${reply.length} chars`)
  voiceLogStage("TTS", `reply-start ${reply.length} chars preview="${reply.slice(0, 60)}"`)
  try {
    const plan = await fetchVoiceFinalSpeak({ sidecarUrl: input.sidecarUrl, text: reply })
    voiceLogStage("TTS", `plan parts=${plan.parts.length} offer=${plan.hasOffer}`)
    await speakParts({
      sidecarUrl: input.sidecarUrl,
      parts: plan.parts,
      raw: input.raw ?? true,
      shouldContinue: input.shouldContinue,
      resolveAudioBytes: input.resolveAudioBytes,
      onPartStart: input.onPartStart,
    })
    voiceLogStage("TTS", "reply-done")
    noteVoiceAction("reply-done")
    return plan
  } finally {
    setVoiceOutput("speaking", false)
    if (input.clearArmedOnDone !== false) clearVoiceReplyArmed()
  }
}

export function defaultSidecarUrl(sidecarUrl?: string | (() => string)) {
  if (typeof sidecarUrl === "function") return sidecarUrl()
  return sidecarUrl ?? voiceSidecarBaseUrl()
}
