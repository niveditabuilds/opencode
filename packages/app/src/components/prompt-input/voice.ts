import { createEffect, createMemo, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import type { PermissionRequest, QuestionAnswer, QuestionRequest } from "@opencode-ai/sdk/v2"
import { createVoice, type VoicePhase } from "@opencode-ai/voice-client/runtime"
import type { VoiceProgressSnapshot } from "@opencode-ai/voice-client/api"
import type { VoicePermissionReply } from "@opencode-ai/voice-client/panel"
import { initVoiceLog, setVoiceLogContext, setVoiceLogEnabled } from "@opencode-ai/voice-client/log"
import { speakAssistantReply } from "@opencode-ai/voice-client/speak"
import { armVoiceReply, noteVoiceAction, voiceOutput } from "@opencode-ai/voice-client/store"
import { hostedVoiceSidecarUrl } from "@/utils/hosted-url"

export type { VoicePhase }
export type VoiceDisplayState = VoicePhase | "off"

const statusKey: Record<VoiceDisplayState, string> = {
  off: "prompt.voice.status.off",
  listening: "prompt.voice.status.listening",
  hearing: "prompt.voice.status.hearing",
  working: "prompt.voice.status.working",
  speaking: "prompt.voice.status.speaking",
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
  voiceReplyProbe?: () => {
    expected: number
    users: number
    userMessageID?: string
    assistantCount: number
    reply?: string
    blocked?: string
  }
}

export function createVoiceComposerState(options: { working: () => boolean; connect?: VoiceConnectOptions }) {
  const [store, setStore] = createStore({
    showDisclosure: false,
    disclosureDismissed: disclosureDismissed(),
  })

  let lastSpokenReplyKey = ""
  let speakInFlight = false

  const sidecarUrl = () => options.connect?.sidecarUrl?.() ?? voiceSidecarBaseUrl()

  const ensureVoiceLog = () => {
    initVoiceLog({
      sidecarUrl: options.connect?.sidecarUrl ?? voiceSidecarBaseUrl,
      active: () => voiceOutput.listenActive || voiceOutput.awaitingReply,
    })
    setVoiceLogContext({ transport: "web" })
    setVoiceLogEnabled(true)
  }

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
    voiceOutput.awaitingReply
    voiceOutput.listenActive
    options.working()
    options.connect?.voiceReplyProbe?.()

    if (!voiceOutput.awaitingReply) {
      noteVoiceAction("skip: awaitingReply false")
      return
    }
    if (options.working()) {
      noteVoiceAction("skip: session working")
      return
    }

    const reply = options.connect?.assistantReplyForVoiceTurn?.()
    if (!reply?.trim()) {
      const blocked = options.connect?.voiceReplyProbe?.().blocked
      noteVoiceAction(blocked ? `skip: ${blocked}` : "skip: no reply")
      return
    }
    const replyKey = reply.trim()
    if (lastSpokenReplyKey === replyKey) {
      noteVoiceAction("skip: already spoken this reply")
      return
    }
    if (speakInFlight) {
      noteVoiceAction("skip: speak in flight")
      return
    }

    lastSpokenReplyKey = replyKey
    speakInFlight = true
    const mode = voiceOutput.listenActive ? "listen session" : "output only"
    noteVoiceAction(`speak: ${reply.length} chars (${mode})`)

    const speak = voiceOutput.listenActive
      ? voice.submitAssistantReply(reply)
      : speakAssistantReply({ sidecarUrl, reply, clearArmedOnDone: true })

    void speak
      .catch((error) => {
        options.connect?.onError(error instanceof Error ? error.message : "voice speak failed")
      })
      .finally(() => {
        speakInFlight = false
      })
  })

  const display = createMemo((): VoiceDisplayState => {
    if (voiceOutput.listenActive) return voice.phase()
    if (voiceOutput.speaking) return "speaking"
    if (voiceOutput.awaitingReply && options.working()) return "working"
    return "off"
  })

  const active = createMemo(() => voiceOutput.listenActive)
  const statusHeader = createMemo(() => voice.questionHeader())

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
    ensureVoiceLog()
    if (!store.disclosureDismissed) setStore("showDisclosure", true)
    voice.toggle()
  }

  onCleanup(() => voice.stop())

  return {
    store,
    display,
    statusHeader,
    active,
    awaitingSpeak: () => voiceOutput.awaitingReply,
    toggle,
    dismissDisclosure: () => {
      if (typeof localStorage !== "undefined") localStorage.setItem("opencode.voice.disclosure", "1")
      setStore({ showDisclosure: false, disclosureDismissed: true })
    },
    expectAssistantReply: (text?: string) => {
      lastSpokenReplyKey = ""
      ensureVoiceLog()
      if (voice.active()) {
        voice.expectAssistantReply(text)
        return
      }
      armVoiceReply(
        `armed TTS${text?.trim() ? ` preview="${text.trim().slice(0, 40)}"` : ""}`,
      )
    },
    setPhase: (_phase: VoicePhase) => {},
  }
}

export type VoiceComposerState = ReturnType<typeof createVoiceComposerState>

export function voiceComposerBorderClass(state: VoiceDisplayState) {
  if (state === "off") return ""
  if (state === "hearing" || state === "speaking") return "ring-1 ring-inset ring-icon-info-active/60"
  if (state === "working") return "ring-1 ring-inset ring-icon-interactive-base/40"
  return "ring-1 ring-inset ring-border-base/80"
}

export { voiceOutput } from "@opencode-ai/voice-client/store"
