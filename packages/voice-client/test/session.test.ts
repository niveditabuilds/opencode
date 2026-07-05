import { describe, expect, test } from "bun:test"
import { sessionInterruptAgent } from "../src/session"

describe("sessionInterruptAgent", () => {
  test("aborts when session id is present", () => {
    let aborted: string | undefined
    const interrupt = sessionInterruptAgent({
      sessionID: () => "session-1",
      abortSession: async (sessionID) => {
        aborted = sessionID
      },
    })
    interrupt()
    expect(aborted).toBe("session-1")
  })

  test("no-ops without session id", () => {
    let calls = 0
    const interrupt = sessionInterruptAgent({
      sessionID: () => undefined,
      abortSession: async () => {
        calls += 1
      },
    })
    interrupt()
    expect(calls).toBe(0)
  })
})
