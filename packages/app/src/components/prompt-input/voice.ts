import { createEffect, createMemo, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import type { PermissionRequest, QuestionAnswer, QuestionRequest } from "@opencode-ai/sdk/v2"
import { createVoice, type VoicePhase } from "@opencode-ai/voice-client/runtime"
import type { VoiceProgressSnapshot } from "@opencode-ai/voice-client/api"
import type { VoicePermissionReply } from "@opencode-ai/voice-client/panel"
import { initVoiceLog, setVoiceLogEnabled, voiceLogLines } from "@opencode-ai/voice-client/log"
import { looksLikeTrivialVoiceAck } from "@opencode-ai/voice-client/reply"
import { hostedVoiceSidecarUrl } from "@/utils/hosted-url"

export type { VoicePhase }
export type VoiceDisplayState = VoicePhase | "off"

const statusKey: Record<VoiceDisplayState, string> = {
  off: "prompt.voice.status.off",
  listening: "prompt.voice.status.listening",
  hearing: "prompt.voice.status.hearing",
  working: "prompt.voice.status.working",
  speaking: "prompt.voice.status.speaking",
  awaiting_reply: "prompt.voice.status.awaitingReply",
  continuing: "prompt.voice.status.continuing",
  awaiting_question: "prompt.voice.status.awaitingQuestion",
  awaiting_permission: "prompt.voice.status.awaitingPermission",
}

export function voiceStatusKey(state: VoiceDisplayState) {
  return statusKey[state]
}

export function voiceSidecarBaseUrl() {
  return hostedVoiceSidecarUrl()
}

function disclosureDismissed() {
  if (typeof localStorage === "undefined") return false
  return localStorage.getItem("opencode.voice.disclosure") === "1"
}

export type VoiceConnectOptions = {
  sidecarUrl?: () => string
  opencodeUrl: () => string
  directory: () => string
  sessionID: () => string | undefined
  agent: () => string
  onError: (message: string) => void
  onTranscript?: (text: string) => void
  onSpeechFinal?: (text: string) => void
  assistantReplyForVoiceTurn?: () => string | undefined
  progressSnapshot?: () => VoiceProgressSnapshot | undefined
  pendingQuestion?: () => QuestionRequest | undefined
  pendingPermission?: () => PermissionRequest | undefined
  replyQuestion?: (input: { requestID: string; answers: QuestionAnswer[] }) => void
  rejectQuestion?: (input: { requestID: string }) => void
  replyPermission?: (input: { requestID: string; reply: VoicePermissionReply }) => void
}

export function createVoiceComposerState(options: { working: () => boolean; connect?: VoiceConnectOptions }) {
  const [store, setStore] = createStore({
    showDisclosure: false,
    disclosureDismissed: disclosureDismissed(),
  })

  let lastSpokenReplyKey = ""

  const voice = createVoice({
    transport: "browser",
    sidecarUrl: options.connect?.sidecarUrl,
    opencodeUrl: () => options.connect!.opencodeUrl(),
    directory: () => options.connect!.directory(),
    sessionID: () => options.connect!.sessionID(),
    agent: () => options.connect!.agent(),
    enabled: () => true,
    working: options.working,
    submitTranscript: (text) => {
      options.connect?.onSpeechFinal?.(text)
    },
    onTranscript: (text) => options.connect?.onTranscript?.(text),
    assistantReplyForVoiceTurn: () => options.connect?.assistantReplyForVoiceTurn?.(),
    progressSnapshot: () => options.connect?.progressSnapshot?.(),
    pendingQuestion: () => options.connect?.pendingQuestion?.(),
    pendingPermission: () => options.connect?.pendingPermission?.(),
    replyQuestion: (input) => options.connect?.replyQuestion?.(input),
    rejectQuestion: (input) => options.connect?.rejectQuestion?.(input),
    replyPermission: (input) => options.connect?.replyPermission?.(input),
    onError: (message) => options.connect?.onError(message),
  })

  createEffect(() => {
    if (!voice.active()) return
    if (!voice.awaitingSpeak()) return
    if (options.working()) return
    const reply = options.connect?.assistantReplyForVoiceTurn?.()
    if (!reply?.trim()) return
    if (looksLikeTrivialVoiceAck(reply)) return
    const replyKey = reply.trim()
    if (lastSpokenReplyKey === replyKey) return
    lastSpokenReplyKey = replyKey
    void voice.speakAssistantReply(reply)
  })

  const display = createMemo((): VoiceDisplayState => (voice.active() ? voice.phase() : "off"))
  const active = createMemo(() => voice.active())
  const statusHeader = createMemo(() => voice.questionHeader())
  const hearingText = () => voice.hearing()

  const toggle = () => {
    if (voice.active()) {
      setVoiceLogEnabled(false)
      voice.stop()
      setStore({ showDisclosure: false })
      return
    }
    if (!options.connect) return
    if (!options.connect.sessionID()) {
      options.connect.onError("prompt.voice.error.noSession")
      return
    }
    initVoiceLog({
      sidecarUrl: options.connect.sidecarUrl,
      active: () => voice.active(),
    })
    setVoiceLogEnabled(true)
    if (!store.disclosureDismissed) setStore("showDisclosure", true)
    voice.toggle()
  }

  onCleanup(() => voice.stop())

  return {
    store,
    display,
    statusHeader,
    hearingText,
    voiceLogLines: () => voiceLogLines(),
    active,
    toggle,
    dismissDisclosure: () => {
      if (typeof localStorage !== "undefined") localStorage.setItem("opencode.voice.disclosure", "1")
      setStore({ showDisclosure: false, disclosureDismissed: true })
    },
    setPhase: (_phase: VoicePhase) => {},
  }
}

export type VoiceComposerState = ReturnType<typeof createVoiceComposerState>

export function voiceComposerBorderClass(state: VoiceDisplayState) {
  if (state === "off") return ""
  if (state === "hearing" || state === "speaking") return "ring-1 ring-inset ring-icon-info-active/60"
  if (state === "working") return "ring-1 ring-inset ring-icon-interactive-base/40"
  if (state === "awaiting_reply") return "ring-1 ring-inset ring-icon-info-active/40"
  if (state === "continuing") return "ring-1 ring-inset ring-icon-info-active/50"
  if (state === "awaiting_question" || state === "awaiting_permission") {
    return "ring-1 ring-inset ring-icon-info-active/50"
  }
  return "ring-1 ring-inset ring-border-base/80"
}
