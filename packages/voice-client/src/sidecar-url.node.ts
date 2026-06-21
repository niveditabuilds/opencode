export function voiceSidecarBaseUrl() {
  const explicit = process.env.VOICE_SIDECAR_URL
  if (explicit) return explicit.replace(/\/+$/, "")
  const port = process.env.VOXCODE_VOICE_PORT ?? process.env.VOICE_SIDECAR_PORT ?? "8765"
  return `http://127.0.0.1:${port}`
}
