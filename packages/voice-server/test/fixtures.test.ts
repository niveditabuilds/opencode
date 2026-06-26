import { describe, expect, test } from "bun:test"
import { fixturePath, readFixtureBytes, readFixtureJson } from "./lib/fixtures"
import { readWavPcm } from "./lib/wav"
import { STT_SAMPLE_RATE } from "../src/xai"

describe("voice fixtures", () => {
  test("manifest lists committed fixtures", async () => {
    const manifest = await readFixtureJson<{ stt: string[]; tts: string[] }>("manifest.json")
    expect(manifest.stt.length).toBeGreaterThan(0)
    expect(manifest.tts.length).toBeGreaterThan(0)
  })

  test("stt wav is 16kHz mono pcm16", async () => {
    const meta = await readFixtureJson<{ sampleRate: number; channels: number; phrase: string }>(
      "stt",
      "run-the-tests.json",
    )
    const wav = await readFixtureBytes("stt", "run-the-tests.wav")
    const pcm = readWavPcm(wav)
    expect(meta.sampleRate).toBe(STT_SAMPLE_RATE)
    expect(pcm.sampleRate).toBe(STT_SAMPLE_RATE)
    expect(pcm.channels).toBe(1)
    expect(pcm.pcm.byteLength).toBeGreaterThan(1000)
    expect(meta.phrase.toLowerCase()).toContain("run")
  })

  test("stt pcm matches wav payload", async () => {
    const wav = await readFixtureBytes("stt", "run-the-tests.wav")
    const pcmFile = await readFixtureBytes("stt", "run-the-tests.pcm")
    const { pcm } = readWavPcm(wav)
    expect(pcmFile.byteLength).toBe(pcm.byteLength)
    expect(Buffer.compare(Buffer.from(pcmFile), Buffer.from(pcm))).toBe(0)
  })

  test("tts mp3 fixtures are non-empty audio", async () => {
    for (const file of ["hello-world.mp3", "offer-phrase.mp3"]) {
      const bytes = await readFixtureBytes("tts", file)
      expect(bytes.byteLength).toBeGreaterThan(500)
      const header = bytes.slice(0, 4)
      const id3 = String.fromCharCode(header[0]!, header[1]!, header[2]!)
      const mp3Frame = header[0] === 0xff && (header[1]! & 0xe0) === 0xe0
      expect(id3 === "ID3" || mp3Frame).toBe(true)
    }
  })

  test("fixture paths resolve under package test dir", () => {
    expect(fixturePath("stt", "run-the-tests.wav")).toContain("/voice-server/test/fixtures/stt/run-the-tests.wav")
  })
})
