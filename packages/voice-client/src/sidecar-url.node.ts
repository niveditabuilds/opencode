export function voiceSidecarBaseUrl() {
  const explicit = process.env.VOICE_SIDECAR_URL ?? process.env.OPENCODE_SERVER_URL
  if (explicit) return explicit.replace(/\/+$/, "")
  return "http://127.0.0.1:4096"
}
