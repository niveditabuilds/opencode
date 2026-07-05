export type VoiceAuth = {
  username?: string
  password: string
}

export function voiceBasicAuth(auth: VoiceAuth) {
  const value = `${auth.username ?? "opencode"}:${auth.password}`
  if (typeof btoa === "function") return btoa(value)
  return Buffer.from(value).toString("base64")
}

export function voiceAuthHeaders(auth?: VoiceAuth): Record<string, string> {
  if (!auth?.password) return {}
  return { Authorization: `Basic ${voiceBasicAuth(auth)}` }
}

export function voiceAuthToken(auth?: VoiceAuth) {
  if (!auth?.password) return undefined
  return voiceBasicAuth(auth)
}

export function voiceStreamUrlWithAuth(stream: string, authToken?: string) {
  if (!authToken) return stream
  const url = new URL(stream)
  url.searchParams.set("auth_token", authToken)
  return url.toString()
}
