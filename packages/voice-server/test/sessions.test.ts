import { describe, expect, test } from "bun:test"
import { sessionJson, streamUrl } from "../src/sessions"

describe("voice session urls", () => {
  test("stream url uses stored control plane origin", () => {
    const session = {
      id: "vs_fixture123",
      opencodeUrl: "http://127.0.0.1:4096",
      controlPlaneUrl: "http://127.0.0.1:4096",
      opencodeSessionId: "ses_fixture",
      directory: "/tmp/project",
      agent: undefined,
      composer: false,
      createdAt: 0,
    }
    expect(sessionJson(session).stream).toBe("ws://127.0.0.1:4096/voice/session/vs_fixture123/stream")
    expect(streamUrl(new URL("https://voice.example.com"), "vs_x")).toBe(
      "wss://voice.example.com/voice/session/vs_x/stream",
    )
  })
})
