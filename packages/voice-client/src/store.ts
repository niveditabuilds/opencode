/** Shared voice output state — TTS arming is independent of STT / mic session. */

import { createStore } from "solid-js/store"

export type VoiceOutputPhase =
  | "off"
  | "listening"
  | "hearing"
  | "working"
  | "speaking"
  | "awaiting_reply"
  | "continuing"
  | "awaiting_question"
  | "awaiting_permission"

export type VoiceOutputStore = {
  /** Mic + sidecar listen session (STT path). */
  listenActive: boolean
  /** Waiting for assistant reply to speak (typed or voice turn). */
  awaitingReply: boolean
  /** TTS playback in progress. */
  speaking: boolean
  lastAction: string
  /** Display phase mirrored from runtime when listen session is on. */
  phase: VoiceOutputPhase
}

export const [voiceOutput, setVoiceOutput] = createStore<VoiceOutputStore>({
  listenActive: false,
  awaitingReply: false,
  speaking: false,
  lastAction: "",
  phase: "off",
})

export function noteVoiceAction(message: string) {
  setVoiceOutput("lastAction", message)
}

export function armVoiceReply(message?: string) {
  setVoiceOutput("awaitingReply", true)
  if (message) noteVoiceAction(message)
}

export function clearVoiceReplyArmed() {
  setVoiceOutput("awaitingReply", false)
}

export function awaitingVoiceReply() {
  return voiceOutput.awaitingReply
}
