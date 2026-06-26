import type { ChatCompleteInput } from "./types"

export class ChatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ChatError"
  }
}

export function chatModel() {
  return process.env.VOICE_LLM_MODEL?.trim() || "grok-4.20-0309-non-reasoning"
}

export function requireXaiApiKey() {
  const key = process.env.XAI_API_KEY?.trim().replace(/\r|\n/g, "") ?? ""
  if (!key) throw new ChatError("XAI_API_KEY is not set")
  return key
}

export async function chatComplete(input: ChatCompleteInput) {
  const apiKey = requireXaiApiKey()
  const baseUrl = (process.env.XAI_BASE_URL ?? "https://api.x.ai/v1").replace(/\/+$/, "")
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: chatModel(),
      messages: [
        { role: "system", content: input.system },
        { role: "user", content: input.user },
      ],
      max_tokens: input.maxTokens,
      temperature: input.temperature ?? 0,
    }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new ChatError(`chat API error ${res.status}: ${text.slice(0, 300)}`)
  }
  const body = (await res.json()) as {
    choices?: Array<{ message?: { content?: unknown } }>
  }
  const content = body.choices?.[0]?.message?.content
  if (typeof content !== "string" || !content.trim()) throw new ChatError("chat API returned empty content")
  return content.trim()
}

export function parseJsonObject(text: string) {
  let stripped = text.trim()
  if (stripped.startsWith("```")) {
    stripped = stripped
      .split("\n")
      .filter((line) => !line.startsWith("```"))
      .join("\n")
      .trim()
  }
  const payload = JSON.parse(stripped) as unknown
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new ChatError("expected JSON object")
  }
  return payload as Record<string, unknown>
}
