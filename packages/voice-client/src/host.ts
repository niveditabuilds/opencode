import { createEffect, createMemo, createSignal } from "solid-js"
import type { Part } from "@opencode-ai/sdk/v2"
import type { VoiceAuth } from "./auth"
import { buildVoiceProgressSnapshot, collectActiveTurnParts } from "./progress"
import { describeAssistantParts, logMissingAssistantReply, readSpeakableAssistantText } from "./reply"
import { voiceLogStage } from "#log"
import { createVoice, sessionInterruptAgent } from "./runtime"
import { armVoiceReply, noteVoiceAction, voiceOutput } from "./store"
import { speakAssistantReply } from "./speak"
import type { VoiceOptions } from "./types"
import { voiceControlPlaneUrl } from "./url"

export type VoiceHostMessage = {
  id: string
  role: string
  parentID?: string
}

export type VoiceHostConnect = {
  opencodeUrl: () => string
  serverUrl?: () => string | undefined
  voiceAuth?: () => VoiceAuth | undefined
  directory: () => string
  sessionID: () => string | undefined
  agent: () => string | undefined
  abortSession: (sessionID: string) => Promise<unknown>
  messages: () => VoiceHostMessage[]
  partsForMessage: (messageID: string) => Part[]
  sessionWorking: () => boolean
  sessionRetrying: () => boolean
  onError: (message: string) => void
  onTranscript?: (text: string) => void
  submitSpeechFinal: (text: string) => void
  pendingQuestion?: VoiceOptions["pendingQuestion"]
  pendingPermission?: VoiceOptions["pendingPermission"]
  replyQuestion?: VoiceOptions["replyQuestion"]
  rejectQuestion?: VoiceOptions["rejectQuestion"]
  replyPermission?: VoiceOptions["replyPermission"]
}

export type VoiceHostOptions = {
  transport: "browser" | "terminal"
  enabled?: () => boolean
  connect: VoiceHostConnect
  /** Arm speak-back on typed prompt submit even without an active mic session. */
  promptSubmitArming?: "always" | "listen-active"
  onSpeakSkip?: (reason: string) => void
}

function linkedAssistants(sessionMessages: VoiceHostMessage[], userMessage: VoiceHostMessage) {
  const byParent = sessionMessages.filter(
    (message) => message.role === "assistant" && message.parentID === userMessage.id,
  )
  if (byParent.length) return byParent
  const userIndex = sessionMessages.findIndex((message) => message.id === userMessage.id)
  if (userIndex < 0) return []
  const linked: VoiceHostMessage[] = []
  for (let i = userIndex + 1; i < sessionMessages.length; i++) {
    const message = sessionMessages[i]!
    if (message.role === "user") break
    if (message.role === "assistant") linked.push(message)
  }
  return linked
}

function speakableReplySize(partsForMessage: (messageID: string) => Part[], messageID: string) {
  let size = 0
  for (const part of partsForMessage(messageID)) {
    if (part.type !== "text" || !("text" in part) || typeof part.text !== "string") continue
    size += part.text.length
  }
  return size
}

export function createVoiceHost(options: VoiceHostOptions) {
  const turn = createVoiceTurnScope({
    messages: options.connect.messages,
    partsForMessage: options.connect.partsForMessage,
    sessionWorking: options.connect.sessionWorking,
    sessionRetrying: options.connect.sessionRetrying,
  })

  const sidecarUrl = () =>
    voiceControlPlaneUrl({
      url: options.connect.opencodeUrl(),
      serverUrl: options.connect.serverUrl?.(),
    })

  const voice = createVoice({
    transport: options.transport,
    opencodeUrl: options.connect.opencodeUrl,
    serverUrl: options.connect.serverUrl,
    voiceAuth: options.connect.voiceAuth,
    directory: options.connect.directory,
    sessionID: options.connect.sessionID,
    agent: options.connect.agent,
    enabled: options.enabled ?? (() => true),
    working: options.connect.sessionWorking,
    submitTranscript: (text) => options.connect.submitSpeechFinal(text),
    interruptAgent: sessionInterruptAgent({
      sessionID: options.connect.sessionID,
      abortSession: options.connect.abortSession,
    }),
    onTranscript: options.connect.onTranscript,
    assistantReplyForVoiceTurn: turn.assistantReplyForVoiceTurn,
    progressSnapshot: turn.progressSnapshot,
    pendingQuestion: options.connect.pendingQuestion,
    pendingPermission: options.connect.pendingPermission,
    replyQuestion: options.connect.replyQuestion,
    rejectQuestion: options.connect.rejectQuestion,
    replyPermission: options.connect.replyPermission,
    onError: options.connect.onError,
  })

  let speakInFlight = false

  const expectAssistantReply = (text?: string) => {
    turn.resetSpokenReplyKey()
    if (voice.active()) {
      voice.expectAssistantReply(text)
      return
    }
    armVoiceReply(`armed TTS${text?.trim() ? ` preview="${text.trim().slice(0, 40)}"` : ""}`)
  }

  const onPromptSubmit = (text: string) => {
    if (turn.isSttSubmit()) return
    if (options.promptSubmitArming === "listen-active" && !voice.active()) {
      voiceLogStage("TTS", "skip: prompt submit without active voice session")
      return
    }
    turn.beginTurn()
    expectAssistantReply(text)
  }

  const skipSpeak = (reason: string) => {
    voiceLogStage("TTS", reason)
    options.onSpeakSkip?.(reason)
    if (options.transport === "browser") noteVoiceAction(reason)
  }

  const replyContentTick = createMemo(() => {
    const expected = turn.expectedUsers()
    if (expected === 0) return 0
    const sessionMessages = options.connect.messages()
    const user = sessionMessages.filter((message) => message.role === "user").at(expected - 1)
    if (!user) return 0
    return linkedAssistants(sessionMessages, user).reduce(
      (total, message) => total + speakableReplySize(options.connect.partsForMessage, message.id),
      0,
    )
  })

  createEffect(() => {
    voiceOutput.awaitingReply
    voiceOutput.listenActive
    options.connect.messages()
    options.connect.sessionWorking()
    options.connect.sessionRetrying()
    turn.expectedUsers()
    turn.turnSeq()
    replyContentTick()
    turn.assistantReply()

    if (!voiceOutput.awaitingReply) {
      skipSpeak("skip: awaitingReply false")
      return
    }
    if (options.connect.sessionRetrying()) {
      skipSpeak("skip: session retrying")
      return
    }
    if (options.connect.sessionWorking()) {
      skipSpeak("skip: session working")
      return
    }

    const reply = turn.assistantReplyForVoiceTurn()
    if (!reply?.trim()) {
      const blocked = turn.replyProbe().blocked
      skipSpeak(blocked ? `skip: ${blocked}` : "skip: no reply")
      return
    }

    const userMessage = turn.activeUserMessage()
    const replyKey = userMessage ? `${userMessage.id}:${reply}` : reply.trim()
    if (turn.spokenReplyKey() === replyKey) {
      skipSpeak("skip: already spoken this reply")
      return
    }
    if (speakInFlight) {
      skipSpeak("skip: speak in flight")
      return
    }

    turn.markSpokenReplyKey(replyKey)
    speakInFlight = true
    const mode = voiceOutput.listenActive ? "listen session" : "output only"
    voiceLogStage("TTS", `session-trigger ${reply.length} chars (${mode})`)
    if (options.transport === "browser") noteVoiceAction(`speak: ${reply.length} chars (${mode})`)

    const speak = voiceOutput.listenActive
      ? voice.submitAssistantReply(reply)
      : speakAssistantReply({
          sidecarUrl,
          reply,
          clearArmedOnDone: true,
          auth: options.connect.voiceAuth?.(),
        })

    void speak
      .catch((error) => {
        options.connect.onError(error instanceof Error ? error.message : "voice speak failed")
      })
      .finally(() => {
        speakInFlight = false
      })
  })

  return {
    voice,
    turn,
    onPromptSubmit,
    expectAssistantReply,
    runSttSubmit: turn.runSttSubmit,
    replyProbe: turn.replyProbe,
  }
}

function createVoiceTurnScope(input: {
  messages: () => VoiceHostMessage[]
  partsForMessage: (messageID: string) => Part[]
  sessionWorking: () => boolean
  sessionRetrying: () => boolean
}) {
  const [expectedUsers, setExpectedUsers] = createSignal(0)
  const [turnSeq, setTurnSeq] = createSignal(0)
  let activeUserMessageID: string | undefined
  let lastSpokenReplyKey = ""
  let lastReplyDebugKey = ""
  let sttSubmit = false

  const beginTurn = () => {
    lastReplyDebugKey = ""
    lastSpokenReplyKey = ""
    activeUserMessageID = undefined
    const usersBefore = input.messages().filter((message) => message.role === "user").length
    setExpectedUsers(usersBefore + 1)
    setTurnSeq((value) => value + 1)
    voiceLogStage("REPLY", `turn-start usersBefore=${usersBefore} expected=${usersBefore + 1}`)
  }

  const assistantReply = createMemo(() => {
    turnSeq()
    const expected = expectedUsers()
    if (expected === 0) return undefined
    const sessionMessages = input.messages()
    const users = sessionMessages.filter((message) => message.role === "user")
    if (users.length < expected) return undefined
    const userMessage = users[expected - 1]
    if (!userMessage) return undefined
    if (!activeUserMessageID) activeUserMessageID = userMessage.id
    const linked = linkedAssistants(sessionMessages, userMessage)
    for (let i = linked.length - 1; i >= 0; i--) {
      const text = readSpeakableAssistantText(input.partsForMessage(linked[i]!.id))
      if (text) return text
    }
    return undefined
  })

  const replyProbe = () => {
    const expected = expectedUsers()
    const sessionMessages = input.messages()
    const users = sessionMessages.filter((message) => message.role === "user")
    if (expected === 0) {
      return { expected, users: users.length, assistantCount: 0, blocked: "expectedUsers=0" as string | undefined }
    }
    if (users.length < expected) {
      return {
        expected,
        users: users.length,
        assistantCount: 0,
        blocked: `waiting user message (${users.length}/${expected})`,
      }
    }
    const userMessage = users[expected - 1]
    if (!userMessage) {
      return { expected, users: users.length, assistantCount: 0, blocked: "user message missing" }
    }
    if (!activeUserMessageID) activeUserMessageID = userMessage.id
    const assistants = linkedAssistants(sessionMessages, userMessage)
    const reply = assistantReply()
    if (reply?.trim()) {
      return {
        expected,
        users: users.length,
        userMessageID: activeUserMessageID,
        assistantCount: assistants.length,
        reply,
      }
    }
    return {
      expected,
      users: users.length,
      userMessageID: activeUserMessageID,
      assistantCount: assistants.length,
      blocked: "assistant has no speakable text yet",
    }
  }

  const assistantReplyForVoiceTurn = () => {
    const reply = assistantReply()
    if (reply?.trim()) {
      const key = `found:${reply.length}`
      if (lastReplyDebugKey !== key) {
        lastReplyDebugKey = key
        voiceLogStage("REPLY", `found ${reply.length} chars preview="${reply.slice(0, 60)}"`)
      }
      return reply
    }

    const expected = expectedUsers()
    if (expected === 0) return undefined

    const sessionMessages = input.messages()
    const users = sessionMessages.filter((message) => message.role === "user")
    const userID = users[expected - 1]?.id
    const linked = userID
      ? linkedAssistants(
          sessionMessages,
          users[expected - 1] ?? { id: userID, role: "user" },
        ).map((message) => message.id)
      : []
    const afterUser = userID
      ? sessionMessages
          .filter((message) => message.role === "assistant" && message.id > userID)
          .map((message) => message.id)
      : []
    const lastAssistant = sessionMessages.findLast((message) => message.role === "assistant")
    const lastParts = lastAssistant ? input.partsForMessage(lastAssistant.id) : []

    const key = [
      users.length,
      expected,
      userID,
      linked.length,
      afterUser.length,
      input.sessionRetrying() ? "retry" : "none",
      input.sessionWorking() ? "working" : "idle",
      describeAssistantParts(lastParts),
    ].join("|")

    if (lastReplyDebugKey === key) return undefined
    lastReplyDebugKey = key

    if (users.length < expected) {
      voiceLogStage("REPLY", `waiting user message ${users.length}/${expected}`)
      return undefined
    }

    voiceLogStage(
      "REPLY",
      [
        `missing user=${userID}`,
        `users=${users.length}/${expected}`,
        `linked=${linked.length}`,
        `afterUser=${afterUser.length}`,
        `sessionWorking=${input.sessionWorking()}`,
        `sessionRetrying=${input.sessionRetrying()}`,
        `lastAssistant=${lastAssistant?.id ?? "none"}`,
        `lastParts=[${describeAssistantParts(lastParts)}]`,
      ].join(" "),
    )
    logMissingAssistantReply({
      userID,
      users: users.length,
      expected,
      linked,
      afterUser,
      partsForMessage: input.partsForMessage,
    })
    return undefined
  }

  const progressSnapshot = () => {
    const expected = expectedUsers()
    if (expected === 0) return undefined
    const users = input.messages().filter((message) => message.role === "user")
    const userMessageID = users[expected - 1]?.id ?? users.at(-1)?.id
    if (!userMessageID) return undefined
    const parts = collectActiveTurnParts({
      messages: input.messages(),
      partsForMessage: input.partsForMessage,
      activeUserMessageID: userMessageID,
    })
    return buildVoiceProgressSnapshot(parts)
  }

  const activeUserMessage = () => {
    const expected = expectedUsers()
    if (expected === 0) return undefined
    return input.messages().filter((message) => message.role === "user").at(expected - 1)
  }

  return {
    beginTurn,
    expectedUsers,
    turnSeq,
    assistantReply,
    assistantReplyForVoiceTurn,
    progressSnapshot,
    replyProbe,
    activeUserMessage,
    resetSpokenReplyKey: () => {
      lastSpokenReplyKey = ""
    },
    spokenReplyKey: () => lastSpokenReplyKey,
    markSpokenReplyKey: (key: string) => {
      lastSpokenReplyKey = key
    },
    isSttSubmit: () => sttSubmit,
    runSttSubmit: (fn: () => void) => {
      sttSubmit = true
      try {
        fn()
      } finally {
        sttSubmit = false
      }
    },
  }
}
