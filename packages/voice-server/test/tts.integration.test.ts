import { describe, expect, test } from "bun:test"
import { readFixtureBytes, readFixtureJson } from "./lib/fixtures"
import { XaiBatchTts } from "../src/tts"

const hasKey = Boolean(process.env.XAI_API_KEY?.trim())

function looksLikeMp3(bytes: Uint8Array) {
  if (bytes.byteLength < 4) return false
  const id3 = String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!)
  if (id3 === "ID3") return true
  return bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0
}

describe("xai tts integration", () => {
  test.skipIf(!hasKey)("batch tts synthesizes mp3", async () => {
    const tts = new XaiBatchTts()
    const audio = await tts.synthesize("Hello world.")
    expect(audio.byteLength).toBeGreaterThan(500)
    expect(looksLikeMp3(audio)).toBe(true)
  }, 30_000)

  test.skipIf(!hasKey)("batch tts matches committed hello-world fixture size band", async () => {
    const meta = await readFixtureJson<{ phrase: string; bytes: number }>("tts", "hello-world.json")
    const fixture = await readFixtureBytes("tts", "hello-world.mp3")
    const tts = new XaiBatchTts()
    const audio = await tts.synthesize(meta.phrase)
    expect(looksLikeMp3(audio)).toBe(true)
    expect(Math.abs(audio.byteLength - fixture.byteLength)).toBeLessThan(fixture.byteLength * 0.5)
  }, 30_000)
})

describe("committed tts fixtures", () => {
  test("hello-world mp3 decodes as audio", async () => {
    const meta = await readFixtureJson<{ bytes: number }>("tts", "hello-world.json")
    const audio = await readFixtureBytes("tts", "hello-world.mp3")
    expect(audio.byteLength).toBe(meta.bytes)
    expect(looksLikeMp3(audio)).toBe(true)
  })
})
