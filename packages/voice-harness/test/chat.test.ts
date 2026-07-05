import { describe, expect, test } from "bun:test"
import { chatComplete, responseComplete } from "../src/chat"

describe("chatComplete", () => {
  test("uses chat completions for one-shot calls", async () => {
    const original = globalThis.fetch
    let url = ""
    let payload: Record<string, unknown> | undefined
    globalThis.fetch = (async (input, init) => {
      url = String(input)
      payload = JSON.parse(String(init?.body)) as Record<string, unknown>
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"action":"ignore"}' } }],
        }),
        { status: 200 },
      )
    }) as typeof fetch
    process.env.XAI_API_KEY = "xai-test-key"
    try {
      const text = await chatComplete({ system: "sys", user: "route", maxTokens: 32 })
      expect(text).toBe('{"action":"ignore"}')
      expect(url).toContain("/chat/completions")
      expect(payload?.messages).toEqual([
        { role: "system", content: "sys" },
        { role: "user", content: "route" },
      ])
    } finally {
      globalThis.fetch = original
    }
  })
})

describe("responseComplete", () => {
  test("starts a stored narrator thread on /v1/responses", async () => {
    const original = globalThis.fetch
    let url = ""
    let payload: Record<string, unknown> | undefined
    globalThis.fetch = (async (input, init) => {
      url = String(input)
      payload = JSON.parse(String(init?.body)) as Record<string, unknown>
      return new Response(
        JSON.stringify({
          id: "resp_test",
          output: [
            {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: "Still working on it." }],
            },
          ],
        }),
        { status: 200 },
      )
    }) as typeof fetch
    process.env.XAI_API_KEY = "xai-test-key"
    try {
      const text = await responseComplete({
        system: "sys",
        user: "updates",
        maxTokens: 40,
        assistant: "I'm reading runtime.ts.",
        onResponseId: (id) => expect(id).toBe("resp_test"),
      })
      expect(text).toBe("Still working on it.")
      expect(url).toContain("/responses")
      const input = payload?.input as Array<{ role: string; content: string }>
      expect(input[0]?.role).toBe("system")
      expect(input[1]?.role).toBe("assistant")
      expect(input[1]?.content).toContain("I'm reading runtime.ts.")
      expect(input[2]?.role).toBe("user")
      expect(payload?.store).toBe(true)
      expect(payload?.previous_response_id).toBeUndefined()
    } finally {
      globalThis.fetch = original
    }
  })

  test("continues with previous_response_id without resending system", async () => {
    const original = globalThis.fetch
    let payload: Record<string, unknown> | undefined
    globalThis.fetch = (async (_url, init) => {
      payload = JSON.parse(String(init?.body)) as Record<string, unknown>
      return new Response(
        JSON.stringify({
          id: "resp_next",
          output_text: "Editing now.",
        }),
        { status: 200 },
      )
    }) as typeof fetch
    process.env.XAI_API_KEY = "xai-test-key"
    try {
      const text = await responseComplete({
        system: "sys",
        user: "trigger=periodic\nupdates:\n[progress] Now: editing",
        maxTokens: 40,
        previousResponseId: "resp_prev",
      })
      expect(text).toBe("Editing now.")
      expect(payload?.previous_response_id).toBe("resp_prev")
      expect(payload?.input).toEqual([
        { role: "user", content: "trigger=periodic\nupdates:\n[progress] Now: editing" },
      ])
    } finally {
      globalThis.fetch = original
    }
  })
})
