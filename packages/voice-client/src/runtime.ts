/**
 * Thin voice runtime: transport + action executor.
 *
 * All conversation intelligence lives in the Python sidecar harness. This client only:
 * - streams mic audio (browser WSS PCM, or terminal PortAudio on the sidecar),
 * - mirrors partial transcripts to the "hearing" UI,
 * - posts activity updates (working / progress / turn_complete) to the harness,
 * - obeys the actions the harness emits (submit_turn / interrupt / speak / set_phase / …).
 *
 * There are no client-side heuristics. The only constants here are mechanical: how often
 * to feed activity to the harness. Every decision and every spoken phrase is chosen by the
 * sidecar's LLM prompts.
 */

import { createSignal, onCleanup } from "solid-js"
import { postVoiceSessionUpdate } from "./api"
import { createVoiceStreamTransport, type ConnectParams } from "./listen"
import { setVoiceLogListener, voiceLogStage } from "#log"
import { createAudioSink, stopMp3, voiceSidecarBaseUrl, type AudioSink } from "#play"
import { base64ToBytes, speakText as speakTextOutput } from "./speak"
import { createVoiceSidecarSession, parseVoiceSidecarEvent, type VoiceSidecarEvent } from "./sidecar"
import { armVoiceReply, clearVoiceReplyArmed, setVoiceOutput, voiceOutput } from "./store"
import type { VoiceOptions, VoicePhase } from "./types"
import { voiceControlPlaneUrl } from "./url"

export type { VoiceOptions, TuiVoiceOptions } from "./types"
export type { VoicePhase, TuiVoicePhase } from "./types"

const FEED_INTERVAL_MS = 8000

export function createVoice(options: VoiceOptions) {
  const transport = options.transport ?? "terminal"
  const [active, setActive] = createSignal(false)
  const [phase, setPhase] = createSignal<VoicePhase>("off")
  const [hearing, setHearing] = createSignal("")
  const [debug, setDebug] = createSignal("")

  setVoiceLogListener((line: string) => setDebug(line))
  onCleanup(() => setVoiceLogListener(undefined))
  voiceLogStage("STATE", "voice runtime ready")

  let running = false
  let voiceID = ""
  let playGeneration = 0
  let ttsActive = false
  let feedTimer: ReturnType<typeof setInterval> | undefined
  let sink: AudioSink | undefined
  let audioGeneration = 0

  const sidecar = () => options.sidecarUrl?.() ?? voiceSidecarBaseUrl()

  const setDisplayPhase = (next: VoicePhase) => {
    if (!active()) return
    setPhase(next)
    setVoiceOutput("phase", next)
  }

  const restorePhase = () => setDisplayPhase(options.working() ? "working" : "listening")

  const setAwaitingReply = (value: boolean) => {
    if (value) armVoiceReply()
    else clearVoiceReplyArmed()
  }

  // ----- harness feed (client → sidecar) -------------------------------

  const postUpdate = (payload: Record<string, unknown>) => {
    if (!voiceID) return Promise.resolve()
    return postVoiceSessionUpdate({ sidecarUrl: sidecar, voiceID, payload }).then(
      () => {},
      () => {},
    )
  }

  const startFeed = () => {
    if (!voiceID) return
    void postUpdate({ event: "working", working: true })
    if (feedTimer) return
    feedTimer = setInterval(() => {
      if (!running || !voiceID) {
        stopFeed()
        return
      }
      const progress = options.progressSnapshot?.()
      if (progress) void postUpdate({ event: "progress", progress })
    }, FEED_INTERVAL_MS)
  }

  const stopFeed = () => {
    if (!feedTimer) return
    clearInterval(feedTimer)
    feedTimer = undefined
  }

  // Hand a finished assistant reply to the harness; it normalizes for TTS and emits a
  // speak action this client plays.
  const submitAssistantReply = (reply: string) => {
    stopFeed()
    void postUpdate({ event: "working", working: false })
    return postUpdate({ event: "turn_complete", reply })
  }

  const expectAssistantReply = (text?: string) => {
    voiceLogStage("STATE", `expect-reply${text?.trim() ? ` preview="${text.trim().slice(0, 40)}"` : ""}`)
    setAwaitingReply(true)
    if (running) startFeed()
  }

  // ----- streamed TTS playback (mechanical; mic muted while speaking) --

  // The sidecar streams PCM frames: audio.start → audio.delta* → audio.end. We schedule
  // them gaplessly and mute the mic for the duration so the STT never hears the output.
  const startAudio = (sampleRate: number, trigger?: string) => {
    audioGeneration++
    sink?.stop()
    ttsActive = true
    stream.setMicEnabled(false)
    setVoiceOutput("speaking", true)
    setDisplayPhase("speaking")
    sink = createAudioSink({ sampleRate: sampleRate || 24000 })
    voiceLogStage("HARNESS", `audio.start${trigger ? ` (${trigger})` : ""}`)
  }

  const pushAudio = (data: string) => {
    if (!sink || !data) return
    sink.push(base64ToBytes(data))
  }

  const endAudio = () => {
    const finished = sink
    sink = undefined
    const generation = audioGeneration
    void (finished ? finished.end() : Promise.resolve()).then(() => {
      if (generation !== audioGeneration) return
      ttsActive = false
      setVoiceOutput("speaking", false)
      if (running) stream.setMicEnabled(true)
      restorePhase()
    })
  }

  const stopPlayback = () => {
    playGeneration++
    audioGeneration++
    stopMp3()
    sink?.stop()
    sink = undefined
    ttsActive = false
    setVoiceOutput("speaking", false)
    if (running) stream.setMicEnabled(true)
  }

  // Fallback for a non-streaming "speak" action: fetch the whole clip and play it.
  const playSpeakFallback = async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || !running) return
    const generation = ++playGeneration
    ttsActive = true
    stream.setMicEnabled(false)
    setVoiceOutput("speaking", true)
    setDisplayPhase("speaking")
    try {
      await speakTextOutput({
        sidecarUrl: sidecar,
        text: trimmed,
        raw: true,
        shouldContinue: () => generation === playGeneration && running,
      })
    } catch (error) {
      if (generation === playGeneration) {
        options.onError(error instanceof Error ? error.message : "voice speak failed")
      }
    }
    if (generation !== playGeneration) return
    ttsActive = false
    setVoiceOutput("speaking", false)
    if (running) stream.setMicEnabled(true)
    restorePhase()
  }

  // ----- actions (sidecar → client) ------------------------------------

  const runTurn = (text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return
    setAwaitingReply(true)
    options.submitTranscript(trimmed)
    startFeed()
  }

  const handleAction = (event: Extract<VoiceSidecarEvent, { type: "action" }>) => {
    if (event.action === "trace") {
      voiceLogStage("HARNESS", event.text ?? "")
      return
    }
    const preview = event.text?.trim() ? ` "${event.text.trim().slice(0, 48)}"` : ""
    voiceLogStage("HARNESS", `${event.action}${event.trigger ? ` (${event.trigger})` : ""}${preview}`)
    if (event.action === "submit_turn" || event.action === "redirect") {
      if (event.text) runTurn(event.text)
      return
    }
    if (event.action === "interrupt") {
      options.interruptAgent?.()
      stopPlayback()
      stopFeed()
      setAwaitingReply(false)
      setDisplayPhase("listening")
      return
    }
    if (event.action === "speak") {
      if (event.text?.trim()) void playSpeakFallback(event.text)
      return
    }
    if (event.action === "set_phase") {
      setDisplayPhase(event.phase === "working" ? "working" : options.working() ? "working" : "listening")
      return
    }
    if (event.action === "expect_reply") {
      setAwaitingReply(true)
      startFeed()
      return
    }
    if (event.action === "clear_expect_reply") {
      setAwaitingReply(false)
      stopFeed()
    }
  }

  // ----- events (sidecar → client) -------------------------------------

  const handleEvent = (event: ReturnType<typeof parseVoiceSidecarEvent>) => {
    if (!event) return
    if (event.type === "ready") {
      voiceID = event.voiceID
      setDisplayPhase("listening")
      return
    }
    if (event.type === "action") {
      handleAction(event)
      return
    }
    if (event.type === "audio.start") {
      startAudio(event.sampleRate ?? 24000, event.trigger)
      return
    }
    if (event.type === "audio.delta") {
      pushAudio(event.data)
      return
    }
    if (event.type === "audio.end") {
      endAudio()
      return
    }
    if (event.type === "audio.error") {
      voiceLogStage("HARNESS", `audio.error ${event.message}`)
      options.onError(event.message)
      endAudio()
      return
    }
    if (event.type === "transcript") {
      if (event.text.trim() && !event.speechFinal) {
        voiceLogStage("STATE", `transcript-partial "${event.text.slice(0, 40)}"`)
        if (!ttsActive && !options.working()) {
          setHearing("")
          setDisplayPhase("hearing")
          options.onTranscript?.(event.text)
          return
        }
        setHearing(event.text)
        return
      }
      if (event.speechFinal) {
        voiceLogStage("STATE", `transcript-final "${event.text.slice(0, 60)}"`)
        setHearing("")
      }
      return
    }
    if (event.type === "status") {
      if (event.state === "working") setDisplayPhase("working")
      else if (event.state === "listening" && !ttsActive && !options.working()) {
        setDisplayPhase(hearing().trim() ? "hearing" : "listening")
      }
      return
    }
    if (event.type === "error") {
      if (ttsActive) stopPlayback()
      options.onError(event.message)
    }
  }

  // ----- transport -----------------------------------------------------

  const createSession = (params: ConnectParams) =>
    createVoiceSidecarSession({
      sidecarUrl: params.sidecarUrl,
      directory: params.directory,
      sessionID: params.sessionID,
      agent: params.agent,
      server: params.server,
      composer: transport === "browser",
      terminalMic: transport === "terminal",
    })

  const stream = createVoiceStreamTransport({
    transport,
    onEvent: handleEvent,
    onError: options.onError,
    onOpen: () => setDisplayPhase("listening"),
    onTerminalClose: () => stop(),
    isRunning: () => running,
    createSession,
  })

  const label = () => {
    if (!active()) return ""
    if (phase() === "hearing") {
      const text = hearing().trim()
      return text ? `Voice · hearing: ${text}` : "Voice · listening… (/voice to stop)"
    }
    if (phase() === "working") return "Voice · working…"
    if (phase() === "speaking") return "Voice · speaking…"
    return "Voice · listening… (/voice to stop)"
  }

  const stop = () => {
    voiceLogStage("STATE", "stop")
    running = false
    playGeneration++
    audioGeneration++
    stopMp3()
    sink?.stop()
    sink = undefined
    ttsActive = false
    stopFeed()
    voiceID = ""
    setHearing("")
    stream.close()
    stream.setConnectParams(undefined)
    setActive(false)
    setPhase("off")
    setVoiceOutput({ listenActive: false, awaitingReply: false, speaking: false, phase: "off" })
  }

  const start = async () => {
    if (running) return
    const sessionID = options.sessionID()
    if (!sessionID) throw new Error("no active session")

    const sidecarUrl = sidecar()
    const directory = options.directory()
    const server = voiceControlPlaneUrl({ url: options.opencodeUrl(), serverUrl: options.serverUrl?.() })
    const params: ConnectParams = { sidecarUrl, directory, sessionID, agent: options.agent(), server }

    running = true
    setActive(true)
    setVoiceOutput("listenActive", true)
    voiceLogStage("STATE", `start session=${sessionID} sidecar=${sidecarUrl}`)
    setDisplayPhase("listening")

    const session = await createSession(params)
    if (transport === "browser") {
      stream.setConnectParams(params)
      await stream.startBrowserMic()
    }
    await stream.attach(session.stream)
  }

  const toggle = () => {
    if (active()) {
      stop()
      return
    }
    if (transport === "terminal" && !process.env.XAI_API_KEY?.trim()) {
      options.onError("XAI_API_KEY is not set")
      return
    }
    void start().catch((error) => {
      options.onError(error instanceof Error ? error.message : "voice failed")
      stop()
    })
  }

  onCleanup(() => stop())

  return {
    active,
    phase,
    hearing,
    questionHeader: (): string | undefined => undefined,
    label,
    debug,
    toggle,
    stop,
    awaitingSpeak: () => voiceOutput.awaitingReply,
    speakAssistantReply: submitAssistantReply,
    submitAssistantReply,
    expectAssistantReply,
    harnessDriven: () => true,
  }
}

export const createTuiVoice = createVoice
