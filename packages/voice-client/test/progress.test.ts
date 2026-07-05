import { describe, expect, test } from "bun:test"
import type { Part } from "@opencode-ai/sdk/v2"
import { buildVoiceProgressSnapshot } from "../src/progress"

describe("buildVoiceProgressSnapshot", () => {
  test("describes active reasoning and running tools", () => {
    const parts: Part[] = [
      {
        id: "prt_1",
        sessionID: "ses_1",
        messageID: "msg_1",
        type: "reasoning",
        text: "## Checking voice runtime\nLooking at progress updates.",
        time: { start: 1 },
      },
      {
        id: "prt_2",
        sessionID: "ses_1",
        messageID: "msg_1",
        type: "tool",
        callID: "call_1",
        tool: "read",
        state: {
          status: "completed",
          input: { filePath: "packages/voice-client/src/runtime.ts" },
          output: "ok",
          title: "Read runtime.ts",
          metadata: {},
          time: { start: 1, end: 2 },
        },
      },
      {
        id: "prt_3",
        sessionID: "ses_1",
        messageID: "msg_1",
        type: "tool",
        callID: "call_2",
        tool: "edit",
        state: {
          status: "running",
          input: { filePath: "packages/voice-client/src/progress.ts" },
          title: "Edit progress.ts",
          time: { start: 3 },
        },
      },
    ]

    const snapshot = buildVoiceProgressSnapshot(parts)
    expect(snapshot.thinking).toBe(true)
    expect(snapshot.current).toContain("progress.ts")
    expect(snapshot.screen).toContain("Now:")
    expect(snapshot.screen).toContain("Thinking")
    expect(snapshot.screen).toContain("Read runtime.ts")
    expect(snapshot.items.some((item) => item.kind === "reasoning" && item.status === "running")).toBe(true)
  })

  test("includes streaming reply text", () => {
    const parts: Part[] = [
      {
        id: "prt_4",
        sessionID: "ses_1",
        messageID: "msg_1",
        type: "text",
        text: "I updated the progress feed so voice can describe tools and thinking.",
        time: { start: 1 },
      },
    ]

    const snapshot = buildVoiceProgressSnapshot(parts)
    expect(snapshot.current).toContain("Writing reply")
    expect(snapshot.items[0]?.detail).toContain("progress feed")
  })
})
