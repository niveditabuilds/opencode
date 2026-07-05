import { describe, expect, test } from "bun:test"
import { VoiceHarness } from "../src/harness"
import { voiceSummary } from "../src/summary"
import type { ChatComplete, ResponseCompleteInput } from "../src/types"

const ignoreRouter: ChatComplete = async () => '{"action":"ignore"}'
const submitRouter: ChatComplete = async () => '{"action":"submit_turn"}'
const speakWriter: ChatComplete = async () => "All set."

describe("voiceSummary", () => {
  test("returns short replies unchanged", () => {
    expect(voiceSummary("Hello there.")).toBe("Hello there.")
  })

  test("adds on-screen tail for long replies", () => {
    const text = "Line one.\n\n".repeat(20) + "packages/foo/bar.ts has the bug."
    expect(voiceSummary(text)).toContain("Details are on screen.")
  })
})

describe("VoiceHarness", () => {
  test("working update emits trace when state changes", () => {
    const harness = new VoiceHarness()
    const actions = harness.pushUpdate({ event: "working", working: true })
    expect(actions).toEqual([{ action: "trace", text: "working=true phase=working (update)" }])
    expect(harness.working).toBe(true)
  })

  test("routeUtterance ignores filler when router says ignore", async () => {
    const harness = new VoiceHarness({ complete: ignoreRouter })
    const actions = await harness.routeUtterance("okay")
    expect(actions[0]?.action).toBe("trace")
    expect(actions[0]?.text).toContain("decision=ignore")
    expect(actions.length).toBe(1)
  })

  test("routeUtterance submits a turn", async () => {
    const harness = new VoiceHarness({ complete: submitRouter })
    const actions = await harness.routeUtterance("fix the scroll bug")
    expect(actions.some((item) => item.action === "submit_turn")).toBe(true)
    expect(actions.some((item) => item.action === "expect_reply")).toBe(true)
    expect(harness.turnId).toBe(1)
  })

  test("noteTurnComplete clears working and speaks rewritten text", async () => {
    const harness = new VoiceHarness({ complete: speakWriter })
    harness.pushUpdate({ event: "working", working: true })
    expect(harness.working).toBe(true)
    const actions = await harness.noteTurnComplete("Hello. Ready when you are.")
    expect(harness.working).toBe(false)
    expect(actions.some((item) => item.action === "speak" && item.text === "All set.")).toBe(true)
    expect(actions.some((item) => item.action === "clear_expect_reply")).toBe(true)
    expect(harness.lastSpoken).toBe("All set.")
  })

  test("periodic summary includes last spoken on first narrator call", async () => {
    let input: ResponseCompleteInput | undefined
    const harness = new VoiceHarness({
      complete: ignoreRouter,
      responseComplete: async (request) => {
        input = request
        return "Now I'm editing the shader."
      },
      now: () => 100,
    })
    harness.lastSpoken = "I'm checking the texture loader."
    harness.working = true
    harness.phase = "working"
    harness.pushUpdate({ event: "progress", progress: { screen: "Now: Editing main.ts (in progress)" } })
    harness.lastPeriodicAt = 0
    const actions = await harness.periodicTick()
    expect(input?.assistant).toBe("I'm checking the texture loader.")
    expect(input?.previousResponseId).toBeUndefined()
    expect(actions.some((item) => item.action === "speak")).toBe(true)
  })
})
