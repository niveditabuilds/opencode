import { describe, expect, test } from "bun:test"
import { readFixtureBytes, readFixtureJson } from "./lib/fixtures"
import { XaiStreamingStt } from "../src/stt"

const hasKey = Boolean(process.env.XAI_API_KEY?.trim())

async function* pcmFrames(pcm: Uint8Array, frameBytes = 3200) {
  for (let offset = 0; offset < pcm.byteLength; offset += frameBytes) {
    yield pcm.slice(offset, Math.min(offset + frameBytes, pcm.byteLength))
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

describe("xai stt integration", () => {
  test.skipIf(!hasKey)("transcribes committed stt fixture", async () => {
    const meta = await readFixtureJson<{ phrase: string }>("stt", "run-the-tests.json")
    const pcm = await readFixtureBytes("stt", "run-the-tests.pcm")
    const stt = new XaiStreamingStt()
    const transcripts: string[] = []

    await stt.stream(pcmFrames(pcm), (event) => {
      if (event.type !== "transcript.partial") return
      const text = typeof event.text === "string" ? event.text : ""
      if (text) transcripts.push(text)
    })

    const heard = transcripts.join(" ").trim().toLowerCase()
    expect(heard.length).toBeGreaterThan(0)
    expect(heard.includes("run") || heard.includes("test")).toBe(true)
    expect(meta.phrase.toLowerCase()).toContain("run")
  }, 60_000)
})
