export class VoiceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "VoiceError"
  }
}

export class SttError extends VoiceError {
  constructor(message: string) {
    super(message)
    this.name = "SttError"
  }
}

export class TtsError extends VoiceError {
  constructor(message: string) {
    super(message)
    this.name = "TtsError"
  }
}

const PLACEHOLDER_KEYS = new Set([
  "…",
  "...",
  "xxx",
  "your-key",
  "your xai voice key",
  "your xai key",
  "<your-key>",
])

export function requireXaiApiKey() {
  const key = process.env.XAI_API_KEY?.trim().replace(/\r|\n/g, "") ?? ""
  if (!key) throw new SttError("XAI_API_KEY is not set")
  if (PLACEHOLDER_KEYS.has(key) || PLACEHOLDER_KEYS.has(key.toLowerCase())) {
    throw new SttError("XAI_API_KEY looks like a placeholder — create a real key at https://console.x.ai")
  }
  if (key.length < 70) {
    throw new SttError(
      `XAI_API_KEY looks truncated (${key.length} chars) — copy the full key from https://console.x.ai`,
    )
  }
  if (/\s/.test(key)) {
    throw new SttError(
      "XAI_API_KEY contains whitespace — re-export it on one line with no spaces: export XAI_API_KEY='xai-…'",
    )
  }
  return key
}

export function xaiBaseUrl() {
  return (process.env.XAI_BASE_URL ?? "https://api.x.ai/v1").replace(/\/+$/, "")
}

export function xaiWsBase() {
  return xaiBaseUrl().replace(/^https:\/\//, "wss://").replace(/^http:\/\//, "ws://")
}

export const STT_SAMPLE_RATE = 16_000
