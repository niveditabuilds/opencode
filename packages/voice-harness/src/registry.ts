import { VoiceHarness } from "./harness"
import type { HarnessAction, HarnessUpdate } from "./types"

type Entry = {
  harness: VoiceHarness
  emit?: (action: HarnessAction) => void
}

export class HarnessRegistry {
  #entries = new Map<string, Entry>()

  create(voiceId: string) {
    const harness = new VoiceHarness()
    this.#entries.set(voiceId, { harness })
    return harness
  }

  get(voiceId: string) {
    return this.#entries.get(voiceId)?.harness
  }

  getOrCreate(voiceId: string) {
    const existing = this.get(voiceId)
    if (existing) return existing
    return this.create(voiceId)
  }

  drop(voiceId: string) {
    this.#entries.delete(voiceId)
  }

  bindOutbox(voiceId: string, emit: (action: HarnessAction) => void) {
    const entry = this.#entries.get(voiceId) ?? { harness: new VoiceHarness() }
    entry.emit = emit
    this.#entries.set(voiceId, entry)
  }

  unbindOutbox(voiceId: string) {
    const entry = this.#entries.get(voiceId)
    if (!entry) return
    entry.emit = undefined
  }

  async applyUpdate(voiceId: string, payload: HarnessUpdate) {
    const harness = this.getOrCreate(voiceId)
    const event = String(payload.event ?? "").trim().toLowerCase()
    const actions =
      event === "turn_complete"
        ? await harness.noteTurnComplete(String(payload.reply ?? payload.text ?? ""))
        : harness.pushUpdate(payload)
    this.#emit(voiceId, actions)
    return actions
  }

  async routeUtterance(voiceId: string, text: string) {
    const harness = this.getOrCreate(voiceId)
    return harness.routeUtterance(text)
  }

  async periodicTick(voiceId: string) {
    const harness = this.get(voiceId)
    if (!harness) return []
    return harness.periodicTick()
  }

  #emit(voiceId: string, actions: HarnessAction[]) {
    const emit = this.#entries.get(voiceId)?.emit
    if (!emit || !actions.length) return
    for (const action of actions) emit(action)
  }
}

export const defaultHarnessRegistry = new HarnessRegistry()
