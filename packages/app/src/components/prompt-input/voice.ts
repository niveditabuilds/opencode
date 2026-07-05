import { createEffect, createMemo, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import type { PermissionRequest, QuestionAnswer, QuestionRequest } from "@opencode-ai/sdk/v2"
import type { VoiceAuth } from "@opencode-ai/voice-client/auth"
import type { VoicePhase } from "@opencode-ai/voice-client/runtime"
import type { VoiceHostConnect } from "@opencode-ai/voice-client/host"
import { createVoiceHost } from "@opencode-ai/voice-client/host"
import type { VoicePermissionReply } from "@opencode-ai/voice-client/panel"
import { initVoiceLog, setVoiceLogContext, setVoiceLogEnabled } from "@opencode-ai/voice-client/log"
import { noteVoiceAction, voiceOutput } from "@opencode-ai/voice-client/store"
import { voiceControlPlaneUrl } from "@opencode-ai/voice-client/url"

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

function disclosureDismissed() {
  if (typeof localStorage === "undefined") return false
  return localStorage.getItem("opencode.voice.disclosure") === "1"
}

export type VoiceConnectOptions = Omit<
  VoiceHostConnect,
  "sessionWorking" | "sessionRetrying" | "abortSession" | "submitSpeechFinal" | "messages" | "partsForMessage"
> & {
  sessionWorking: () => boolean
  abortSession: (sessionID: string) => Promise<unknown>
  messages: VoiceHostConnect["messages"]
  partsForMessage: VoiceHostConnect["partsForMessage"]
  submitSpeechFinal: VoiceHostConnect["submitSpeechFinal"]
  voiceReplyProbe?: () => ReturnType<ReturnType<typeof createVoiceHost>["replyProbe"]>
}

export function createVoiceComposerState(options: { working: () => boolean; connect?: VoiceConnectOptions }) {
  const [store, setStore] = createStore({
    showDisclosure: false,
    disclosureDismissed: disclosureDismissed(),
  })

  const sidecarUrl = () =>
    voiceControlPlaneUrl({
      url: options.connect!.opencodeUrl(),
      serverUrl: options.connect?.serverUrl?.(),
    })

  const ensureVoiceLog = () => {
    initVoiceLog({
      sidecarUrl,
      voiceAuth: () => options.connect?.voiceAuth?.(),
      active: () => voiceOutput.listenActive || voiceOutput.awaitingReply,
    })
    setVoiceLogContext({ transport: "web" })
    setVoiceLogEnabled(true)
  }

  const host = createVoiceHost({
    transport: "browser",
    promptSubmitArming: "always",
    onSpeakSkip: noteVoiceAction,
    connect: {
      opencodeUrl: () => options.connect!.opencodeUrl(),
      serverUrl: () => options.connect?.serverUrl?.(),
      voiceAuth: () => options.connect?.voiceAuth?.(),
      directory: () => options.connect!.directory(),
      sessionID: () => options.connect!.sessionID(),
      agent: () => options.connect!.agent(),
      abortSession: (sessionID) => options.connect!.abortSession(sessionID),
      messages: () => options.connect!.messages(),
      partsForMessage: (messageID) => options.connect!.partsForMessage(messageID),
      sessionWorking: options.working,
      sessionRetrying: () => false,
      onError: (message) => options.connect!.onError(message),
      onTranscript: (text) => options.connect?.onTranscript?.(text),
      submitSpeechFinal: (text) => options.connect!.submitSpeechFinal(text),
      pendingQuestion: () => options.connect?.pendingQuestion?.(),
      pendingPermission: () => options.connect?.pendingPermission?.(),
      replyQuestion: (input) => options.connect?.replyQuestion?.(input),
      rejectQuestion: (input) => options.connect?.rejectQuestion?.(input),
      replyPermission: (input) => options.connect?.replyPermission?.(input),
    },
  })

  const voice = host.voice

  createEffect(() => {
    options.connect?.voiceReplyProbe?.()
    host.replyProbe()
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
    onPromptSubmit: (text: string) => {
      ensureVoiceLog()
      host.onPromptSubmit(text)
    },
    beginTurn: () => host.turn.beginTurn(),
    runSttSubmit: host.runSttSubmit,
    expectAssistantReply: (text?: string) => {
      ensureVoiceLog()
      host.expectAssistantReply(text)
    },
    replyProbe: host.replyProbe,
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
