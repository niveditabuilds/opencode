/**
 * Thin voice runtime: transport + action executor.
 *
 * Conversation intelligence lives in the OpenCode voice harness (same server process). This client:
 * - captures mic audio locally and streams PCM to the voice server,
 * - mirrors partial transcripts to the "hearing" UI,
 * - posts activity updates (working / progress / turn_complete) to the harness,
 * - obeys the actions the harness emits (submit_turn / interrupt / speak / set_phase / …).
 */

import { createSignal, onCleanup } from "solid-js"
import { postVoiceSessionUpdate } from "./api"
import { createVoiceStreamTransport, type ConnectParams } from "./listen"
import { clearVoiceLogContext, setVoiceLogContext, setVoiceLogListener, voiceLogStage } from "#log"
import { createAudioSink, stopMp3, type AudioSink } from "#play"
import { base64ToBytes, speakText as speakTextOutput } from "./speak"
import { createVoiceSidecarSession, parseVoiceSidecarEvent, type VoiceSidecarEvent } from "./sidecar"
import { armVoiceReply, clearVoiceReplyArmed, setVoiceOutput, voiceOutput } from "./store"
import type { VoiceOptions, VoicePhase } from "./types"
import { voiceAuthHeaders, voiceAuthToken, voiceStreamUrlWithAuth } from "./auth"
import { voiceControlPlaneUrl, voiceStreamUrl } from "./url"

export type { VoiceOptions, TuiVoiceOptions } from "./types"
export type { VoicePhase, TuiVoicePhase } from "./types"

const FEED_INTERVAL_MS = 8000

// Barge-in: on full-duplex transports we keep the mic live while the agent speaks so the user can
// talk over it. The browser's AEC (echoCancellation in getUserMedia) removes the agent's own voice;
// the TUI has no AEC, so it stays half-duplex (mic muted while speaking).
const BARGE_IN_GRACE_MS = 400 // ignore the mic right after audio.start while AEC converges
const BARGE_IN_MIN_CHARS = 3 // require a real word, not an echo blip, before stopping playback

export function createVoice(options: VoiceOptions) {
  const transport = options.transport ?? "terminal"
  const fullDuplex = transport === "browser"
  const [active, setActive] = createSignal(false)
  const [phase, setPhase] = createSignal<VoicePhase>("off")
  const [hearing, setHearing] = createSignal("")
  const [debug, setDebug] = createSignal("")

  setVoiceLogListener((line: string) => setDebug(line))
  onCleanup(() => setVoiceLogListener(undefined))
  setVoiceLogContext({ transport: transport === "browser" ? "web" : "tui" })
  voiceLogStage("STATE", "voice runtime ready")

  let running = false
  let voiceID = ""
  let playGeneration = 0
  let ttsActive = false
  let feedTimer: ReturnType<typeof setInterval> | undefined
  let playback: AudioSink | undefined
  let streamOpen = false
  let audioGeneration = 0
  let speakingSince = 0
  let bestHeard = ""

  const sidecar = () =>
    options.sidecarUrl?.() ??
    voiceControlPlaneUrl({ url: options.opencodeUrl(), serverUrl: options.serverUrl?.() })

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
    return postVoiceSessionUpdate({
      sidecarUrl: sidecar,
      voiceID,
      payload,
      auth: options.voiceAuth?.(),
    }).then(
      () => {},
      () => {},
    )
  }

  const startFeed = () => {
    if (!voiceID) return
    voiceLogStage("STATE", "post working=true (start-feed)")
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
    voiceLogStage("STATE", "post turn-complete")
    return postUpdate({ event: "turn_complete", reply })
  }

  const expectAssistantReply = (text?: string) => {
    voiceLogStage("STATE", `expect-reply${text?.trim() ? ` preview="${text.trim().slice(0, 40)}"` : ""}`)
    setAwaitingReply(true)
    if (running) startFeed()
  }

  // ----- streamed TTS playback (mechanical; mic muted while speaking) --

  // The sidecar streams PCM frames: audio.start → audio.delta* → audio.end. TUI pipes them
  // to ffplay as they arrive; web schedules them on Web Audio. Keep `playback` until the sink
  // actually finishes — audio.end arrives when synthesis completes, not when speakers go quiet.
  const stopStreamPlayback = () => {
    streamOpen = false
    playback?.stop()
    playback = undefined
    stopMp3()
  }

  const startAudio = (sampleRate: number, trigger?: string) => {
    audioGeneration++
    stopStreamPlayback()
    streamOpen = true
    ttsActive = true
    speakingSince = Date.now()
    if (!fullDuplex) stream.setMicEnabled(false)
    setVoiceOutput("speaking", true)
    setDisplayPhase("speaking")
    playback = createAudioSink({ sampleRate: sampleRate || 24000 })
    voiceLogStage("HARNESS", `audio.start${trigger ? ` (${trigger})` : ""}`)
  }

  const pushAudio = (data: string) => {
    if (!streamOpen || !playback || !data) return
    playback.push(base64ToBytes(data))
  }

  const endAudio = () => {
    streamOpen = false
    const finished = playback
    const generation = audioGeneration
    void (finished ? finished.end() : Promise.resolve()).then(() => {
      if (generation !== audioGeneration) return
      if (playback === finished) playback = undefined
      ttsActive = false
      setVoiceOutput("speaking", false)
      if (running) stream.setMicEnabled(true)
      restorePhase()
    })
  }

  const stopPlayback = () => {
    playGeneration++
    audioGeneration++
    stopStreamPlayback()
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
    speakingSince = Date.now()
    if (!fullDuplex) stream.setMicEnabled(false)
    setVoiceOutput("speaking", true)
    setDisplayPhase("speaking")
    try {
      await speakTextOutput({
        sidecarUrl: sidecar,
        text: trimmed,
        raw: true,
        auth: options.voiceAuth?.(),
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
    const harness = text.trim()
    const heard = bestHeard.trim()
    const trimmed = heard.length > harness.length ? heard : harness
    bestHeard = ""
    if (!trimmed) return
    if (heard.length > harness.length) {
      voiceLogStage("STATE", `submit heard=${heard.length} chars over harness=${harness.length}`)
    }
    setAwaitingReply(true)
    options.submitTranscript(trimmed)
    startFeed()
  }

  const handleAction = (event: Extract<VoiceSidecarEvent, { type: "action" }>) => {
    if (event.turnId !== undefined) setVoiceLogContext({ turnId: event.turnId })
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
      if (event.text?.trim() && !event.trigger) void playSpeakFallback(event.text)
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

  // Decide whether a transcript while the agent is speaking is a real barge-in. Wait out the AEC
  // convergence window after audio.start, and require more than an echo blip for non-final partials.
  const bargeInReady = (event: Extract<VoiceSidecarEvent, { type: "transcript" }>) => {
    if (Date.now() - speakingSince < BARGE_IN_GRACE_MS) return false
    const text = event.text.trim()
    if (event.speechFinal) return text.length > 0
    return text.length >= BARGE_IN_MIN_CHARS
  }

  const handleEvent = (event: ReturnType<typeof parseVoiceSidecarEvent>) => {
    if (!event) return
    if (event.type === "ready") {
      voiceID = event.voiceID
      setVoiceLogContext({ voiceId: voiceID })
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
      const line = event.text.trim()
      if (line.length > bestHeard.length) bestHeard = line
      // Barge-in: the mic is live during playback on full-duplex transports. If the user talks over
      // the agent, stop the speaker and hand the floor back; the harness router decides whether the
      // new utterance is a fresh turn or a redirect once it streams in.
      if (fullDuplex && ttsActive) {
        if (!bargeInReady(event)) return // echo residue or too soon after audio.start — keep speaking
        voiceLogStage("STATE", `barge-in "${event.text.slice(0, 40)}"`)
        stopPlayback()
      }
      if (event.text.trim() && !event.speechFinal) {
        voiceLogStage("STATE", `transcript-partial "${event.text.slice(0, 40)}"`)
        setHearing(event.text)
        setDisplayPhase("hearing")
        if (!ttsActive && !options.working()) options.onTranscript?.(event.text)
        return
      }
      if (event.speechFinal) {
        voiceLogStage("STATE", `transcript-final "${event.text.slice(0, 60)}"`)
        if (event.text.trim() && !ttsActive && !options.working()) options.onTranscript?.(event.text)
        setHearing("")
        return
      }
    }
    if (event.type === "status") {
      if (event.state === "idle" && event.reason === "no speech") {
        voiceLogStage("STATE", "no speech detected")
      }
      if (event.state === "working") setDisplayPhase("working")
      else if (event.state === "listening" && !ttsActive && !options.working()) {
        setDisplayPhase(hearing().trim() ? "hearing" : "listening")
      }
      return
    }
    if (event.type === "error") {
      if (ttsActive) stopPlayback()
      voiceLogStage("STATE", `server error: ${event.message}`)
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
      auth: options.voiceAuth?.(),
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
    stopPlayback()
    stopFeed()
    voiceID = ""
    bestHeard = ""
    clearVoiceLogContext(["voiceId", "turnId"])
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
    const authToken = voiceAuthToken(options.voiceAuth?.())
    const params: ConnectParams = {
      sidecarUrl,
      directory,
      sessionID,
      agent: options.agent(),
      server,
      authToken,
    }

    running = true
    setActive(true)
    setVoiceOutput("listenActive", true)
    setVoiceLogContext({ sessionId: sessionID })
    voiceLogStage("STATE", `start session=${sessionID} voice=${sidecarUrl}`)
    setDisplayPhase("listening")

    stream.setConnectParams(params)
    const session = await createSession(params)
    const streamUrl = session.stream ?? voiceStreamUrl(sidecarUrl, session.id)
    voiceLogStage("STATE", `attach stream=${streamUrl}`)
    await stream.attach(streamUrl)
    await stream.startMic()
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
