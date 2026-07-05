import { describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createVoiceHost } from "../src/host"

describe("createVoiceHost", () => {
  test("arms a turn and waits for the matching user message", () => {
    createRoot((dispose) => {
      const host = createVoiceHost({
        transport: "terminal",
        connect: {
          opencodeUrl: () => "http://127.0.0.1:4096/",
          directory: () => "/tmp",
          sessionID: () => "ses_test",
          agent: () => "build",
          abortSession: async () => {},
          messages: () => [],
          partsForMessage: () => [],
          sessionWorking: () => false,
          sessionRetrying: () => false,
          onError: () => {},
          submitSpeechFinal: () => {},
        },
      })

      host.onPromptSubmit("hi")
      expect(host.replyProbe().blocked).toBe("waiting user message (0/1)")
      dispose()
    })
  })
})
