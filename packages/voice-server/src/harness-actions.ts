import type { HarnessAction } from "@opencode-ai/voice-harness"
import { defaultHarnessRegistry } from "@opencode-ai/voice-harness"
import { TtsError } from "./xai"
import { XaiTtsStream } from "./tts"
import { setLogContext, writeLog } from "./voice-log"

export type VoiceSender = {
  sendJson: (payload: Record<string, unknown>) => Promise<void>
  open: boolean
}

export class Speaker {
  #tts = new XaiTtsStream()
  #send: VoiceSender
  #voiceId?: string
  #lock = Promise.resolve()
  #generation = 0

  constructor(send: VoiceSender, voiceId?: string) {
    this.#send = send
    this.#voiceId = voiceId
  }

  interrupt() {
    this.#generation += 1
  }

  async speak(text: string, trigger: string) {
    const body = text.trim()
    if (!body) return
    this.#lock = this.#lock.then(() => this.#speakLocked(body, trigger))
    await this.#lock
  }

  async #speakLocked(body: string, trigger: string) {
    const generation = this.#generation
    const shouldContinue = () => generation === this.#generation && this.#send.open
    await this.#send.sendJson({
      type: "audio.start",
      trigger,
      sampleRate: this.#tts.sampleRate,
      codec: "pcm",
    })
    writeLog("TTS", `audio.start trigger=${trigger} chars=${body.length}`, { voiceId: this.#voiceId })
    try {
      for await (const pcm of this.#tts.synthesize(body, shouldContinue)) {
        if (!shouldContinue()) break
        await this.#send.sendJson({
          type: "audio.delta",
          data: bytesToBase64(pcm),
        })
      }
    } catch (error) {
      const message = error instanceof TtsError ? error.message : "tts stream error"
      writeLog("TTS", `audio.error trigger=${trigger} message=${message}`, { voiceId: this.#voiceId })
      await this.#send.sendJson({ type: "audio.error", message })
    } finally {
      writeLog("TTS", `audio.end trigger=${trigger}`, { voiceId: this.#voiceId })
      await this.#send.sendJson({ type: "audio.end" })
    }
  }
}

export async function emitHarnessActions(input: {
  send: VoiceSender
  speaker: Speaker
  actions: HarnessAction[]
  voiceId?: string
}) {
  const harness = input.voiceId ? defaultHarnessRegistry.get(input.voiceId) : undefined
  if (input.voiceId && harness) {
    setLogContext(input.voiceId, { voiceId: input.voiceId, turnId: harness.turnId })
  }
  for (const item of input.actions) {
    const action = item.action
    if (action === "interrupt") {
      writeLog("HARNESS", "interrupt", { voiceId: input.voiceId })
      input.speaker.interrupt()
    }
    if (action === "speak" && item.text) {
      const trigger = item.trigger ?? ""
      writeLog("HARNESS", `speak stream trigger=${trigger} chars=${item.text.length}`, { voiceId: input.voiceId })
      await input.send.sendJson({
        type: "action",
        action: "trace",
        text: `speak stream trigger=${trigger} chars=${item.text.length}`,
      })
      await input.speaker.speak(item.text, trigger)
      continue
    }
    if (action === "submit_turn") {
      writeLog("HARNESS", `submit_turn turnId=${item.turnId ?? ""} chars=${item.text?.length ?? 0}`, {
        voiceId: input.voiceId,
        turnId: item.turnId,
      })
    }
    await input.send.sendJson({ type: "action", ...item })
    if (action === "set_phase") {
      const phase = item.phase === "working" ? "working" : "listening"
      await input.send.sendJson({ type: "status", state: phase })
    }
  }
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = ""
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
  return btoa(binary)
}
