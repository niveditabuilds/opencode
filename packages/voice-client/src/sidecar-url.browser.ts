export function voiceSidecarBaseUrl() {
  const explicit = import.meta.env.VITE_OPENCODE_SERVER_URL
  if (explicit) return explicit.replace(/\/+$/, "")
  const host = import.meta.env.VITE_OPENCODE_SERVER_HOST ?? "127.0.0.1"
  const port = import.meta.env.VITE_OPENCODE_SERVER_PORT ?? "4096"
  return `http://${host}:${port}`
}
