import { describe, expect, test } from "bun:test"
import { bestTranscript } from "../src/transcript"

describe("bestTranscript", () => {
  test("prefers accumulated committed text over a short speech-final tail", () => {
    const committed = ["I don't see anything.", "I think it's transparent."]
    expect(bestTranscript(committed, "There's")).toBe("I don't see anything. I think it's transparent.")
  })

  test("uses longer cumulative speech-final text", () => {
    const committed = ["I don't see"]
    const full = "I don't see anything. I think it's transparent."
    expect(bestTranscript(committed, full)).toBe(full)
  })

  test("joins non-overlapping committed segments", () => {
    expect(bestTranscript(["hello"], "world")).toBe("hello world")
  })
})
