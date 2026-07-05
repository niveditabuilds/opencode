import type { ChatCompleteInput, ResponseCompleteInput } from "./types"

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

function apiBase() {
  return (process.env.XAI_BASE_URL ?? "https://api.x.ai/v1").replace(/\/+$/, "")
}

export async function chatComplete(input: ChatCompleteInput) {
  const apiKey = requireXaiApiKey()
  const res = await fetch(`${apiBase()}/chat/completions`, {
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

export async function responseComplete(input: ResponseCompleteInput) {
  const apiKey = requireXaiApiKey()
  const inputMessages: Array<{ role: string; content: string }> = []
  if (!input.previousResponseId) inputMessages.push({ role: "system", content: input.system })
  if (!input.previousResponseId && input.assistant?.trim()) {
    inputMessages.push({
      role: "assistant",
      content: `Last thing spoken to the user (verbatim TTS):\n${input.assistant.trim()}`,
    })
  }
  inputMessages.push({ role: "user", content: input.user })
  const body: Record<string, unknown> = {
    model: chatModel(),
    input: inputMessages,
    max_output_tokens: input.maxTokens,
    temperature: input.temperature ?? 0,
    store: true,
  }
  if (input.previousResponseId) body.previous_response_id = input.previousResponseId
  const res = await fetch(`${apiBase()}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new ChatError(`responses API error ${res.status}: ${text.slice(0, 300)}`)
  }
  const payload = (await res.json()) as Record<string, unknown>
  if (typeof payload.id === "string") input.onResponseId?.(payload.id)
  const text = readResponseText(payload)
  if (!text) throw new ChatError("responses API returned empty content")
  return text
}

function readResponseText(payload: Record<string, unknown>) {
  if (typeof payload.output_text === "string" && payload.output_text.trim()) return payload.output_text.trim()
  if (!Array.isArray(payload.output)) return ""
  const chunks: string[] = []
  for (const item of payload.output) {
    if (!item || typeof item !== "object") continue
    const row = item as Record<string, unknown>
    if (row.type !== "message" || !Array.isArray(row.content)) continue
    for (const part of row.content) {
      if (!part || typeof part !== "object") continue
      const piece = part as Record<string, unknown>
      if (piece.type === "output_text" && typeof piece.text === "string") chunks.push(piece.text)
    }
  }
  return chunks.join("").trim()
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
