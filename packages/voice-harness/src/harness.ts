import { chatComplete, parseJsonObject, responseComplete } from "./chat"
import { BUFFER_SUMMARY_SYSTEM, ROUTER_SYSTEM, TURN_COMPLETE_SYSTEM } from "./prompts"
import { voiceSummary } from "./summary"
import type {
  ChatComplete,
  HarnessAction,
  HarnessPhase,
  HarnessRouteDecision,
  HarnessUpdate,
  ResponseComplete,
} from "./types"
import { PERIODIC_INTERVAL_S } from "./types"

export { PERIODIC_INTERVAL_S }

type BufferEntry = {
  kind: string
  text: string
  at: number
}

export type VoiceHarnessOptions = {
  complete?: ChatComplete
  responseComplete?: ResponseComplete
  now?: () => number
}

export class VoiceHarness {
  phase: HarnessPhase = "listening"
  working = false
  buffer: BufferEntry[] = []
  lastSpoken = ""
  #summaryResponseId = ""
  lastSubmitted = ""
  progress: Record<string, unknown> = {}
  lastPeriodicAt = 0
  turnId = 0

  #complete: ChatComplete
  #responseComplete: ResponseComplete
  #now: () => number

  constructor(options?: VoiceHarnessOptions) {
    this.#complete = options?.complete ?? chatComplete
    this.#responseComplete = options?.responseComplete ?? responseComplete
    this.#now = options?.now ?? (() => Date.now() / 1000)
  }

  pushUpdate(payload: HarnessUpdate): HarnessAction[] {
    const event = String(payload.event ?? payload.kind ?? "update")
      .trim()
      .toLowerCase()
    if (event === "working") {
      const was = this.working
      this.working = Boolean(payload.working)
      if (this.working) this.phase = "working"
      else if (this.phase === "working") this.phase = "listening"
      if (this.working !== was) {
        return [{ action: "trace", text: `working=${this.working} phase=${this.phase} (update)` }]
      }
      return []
    }
    if (event === "progress") {
      this.progress = coerceProgress(payload)
      const screen = typeof this.progress.screen === "string" ? this.progress.screen.trim() : ""
      this.buffer.push({
        kind: "progress",
        text: screen || JSON.stringify(this.progress, Object.keys(this.progress).sort()),
        at: this.#now(),
      })
      return []
    }
    const text = String(payload.text ?? payload.detail ?? payload.reply ?? "").trim()
    if (!text) return []
    this.buffer.push({ kind: event, text, at: this.#now() })
    return []
  }

  async routeUtterance(text: string): Promise<HarnessAction[]> {
    const stripped = text.trim()
    if (!stripped) return []
    const decision = await this.#route(stripped)
    const trace: HarnessAction = {
      action: "trace",
      text: `decision=${decision} phase=${this.phase} working=${this.working} «${stripped.slice(0, 48)}»`,
    }
    const routed = await this.#applyRoute(stripped, decision)
    return [trace, ...routed]
  }

  async noteTurnComplete(reply: string): Promise<HarnessAction[]> {
    this.working = false
    this.phase = "listening"
    const bufferN = this.#bufferCount()
    const bufferText = this.#bufferText()
    let prompt = reply.trim()
    if (bufferText) prompt = `activity so far:\n${bufferText}\n\nfinal reply:\n${reply.trim()}`
    const speak = await this.#spokenText(prompt, TURN_COMPLETE_SYSTEM, voiceSummary(reply))
    this.buffer = []
    this.#summaryResponseId = ""
    this.progress = {}
    if (speak) this.lastSpoken = speak
    const actions: HarnessAction[] = [
      { action: "trace", text: `turn_complete flush entries=${bufferN} spoke=${Boolean(speak)}` },
      { action: "set_phase", phase: "listening" },
      { action: "clear_expect_reply" },
    ]
    if (speak) actions.splice(1, 0, { action: "speak", text: speak, trigger: "turn_complete" })
    return actions
  }

  async periodicTick(): Promise<HarnessAction[]> {
    const now = this.#now()
    if (this.phase !== "working" || !this.working) return []
    if (now - this.lastPeriodicAt < PERIODIC_INTERVAL_S) return []
    if (!this.buffer.length) return []
    this.lastPeriodicAt = now
    const bufferN = this.#bufferCount()
    const speak = await this.#summarizeBuffer("periodic")
    const trace: HarnessAction = {
      action: "trace",
      text: `periodic flush entries=${bufferN} spoke=${Boolean(speak)}`,
    }
    if (!speak) return [trace]
    this.lastSpoken = speak
    return [trace, { action: "speak", text: speak, trigger: "periodic" }]
  }

  async #route(text: string): Promise<HarnessRouteDecision> {
    const defaultDecision: HarnessRouteDecision =
      this.phase === "listening" && !this.working ? "submit_turn" : "ignore"
    const user = `phase=${this.phase}\nworking=${this.working}\nlastSpoken=${this.lastSpoken.slice(0, 400)}\nutterance=${text}`
    try {
      const payload = parseJsonObject(
        await this.#complete({ system: ROUTER_SYSTEM, user, maxTokens: 32 }),
      )
      const action = String(payload.action ?? "")
        .trim()
        .toLowerCase()
      if (
        action === "submit_turn" ||
        action === "redirect" ||
        action === "interrupt" ||
        action === "status" ||
        action === "ignore"
      ) {
        return action
      }
      return defaultDecision
    } catch {
      return defaultDecision
    }
  }

  async #applyRoute(text: string, decision: HarnessRouteDecision): Promise<HarnessAction[]> {
    if (decision === "interrupt") {
      this.working = false
      this.phase = "listening"
      return [
        { action: "interrupt" },
        { action: "set_phase", phase: "listening" },
        { action: "clear_expect_reply" },
      ]
    }
    if (decision === "status") {
      const bufferN = this.#bufferCount()
      const speak = await this.#summarizeBuffer("status")
      const actions: HarnessAction[] = [
        { action: "trace", text: `status flush entries=${bufferN} spoke=${Boolean(speak)}` },
        { action: "set_phase", phase: this.phase },
      ]
      if (speak) {
        this.lastSpoken = speak
        actions.splice(1, 0, { action: "speak", text: speak, trigger: "status" })
      }
      return actions
    }
    if (decision === "submit_turn" || decision === "redirect") {
      this.turnId += 1
      const turn = this.turnId
      this.working = true
      this.phase = "working"
      this.lastSubmitted = text
      const actions: HarnessAction[] = []
      if (decision === "redirect") actions.push({ action: "interrupt" })
      actions.push(
        { action: "submit_turn", text, turnId: turn },
        { action: "expect_reply" },
        { action: "set_phase", phase: "working" },
      )
      return actions
    }
    return []
  }

  async #summarizeBuffer(trigger: string) {
    const body = this.#bufferText()
    if (!body && !this.lastSpoken && !this.#summaryResponseId) return ""
    const user = `trigger=${trigger}\nupdates:\n${body || "(none)"}`
    const fallback = this.lastSpoken || "Still working on that."
    try {
      const speak = (
        await this.#responseComplete({
          system: BUFFER_SUMMARY_SYSTEM,
          user,
          maxTokens: 160,
          assistant: this.#summaryResponseId ? undefined : this.lastSpoken || undefined,
          previousResponseId: this.#summaryResponseId || undefined,
          onResponseId: (id) => {
            this.#summaryResponseId = id
          },
        })
      ).trim()
      this.buffer = []
      if (speak) this.lastSpoken = speak
      return speak
    } catch {
      this.#summaryResponseId = ""
      this.buffer = []
      return fallback.trim()
    }
  }

  #bufferCount() {
    return this.buffer.length
  }

  #bufferText() {
    return this.buffer
      .map((entry) => `[${entry.kind.replaceAll("_", " ")}] ${entry.text}`.trim())
      .join("\n")
      .trim()
  }

  async #spokenText(user: string, system: string, fallback: string) {
    try {
      return (await this.#complete({ system, user, maxTokens: 160 })).trim()
    } catch {
      return fallback.trim()
    }
  }
}

function coerceProgress(payload: HarnessUpdate) {
  if (payload.progress && typeof payload.progress === "object") return { ...payload.progress }
  const out: Record<string, unknown> = {}
  for (const key of ["screen", "items", "current", "thinking", "reads", "searches", "lists", "shell"] as const) {
    if (key in payload) out[key] = payload[key]
  }
  return out
}
