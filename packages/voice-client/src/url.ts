const INTERNAL_HOSTS = new Set(["opencode.internal"])

export function voiceControlPlaneUrl(input: { url: string; serverUrl?: string }) {
  if (input.serverUrl && !INTERNAL_HOSTS.has(new URL(input.serverUrl).hostname)) return input.serverUrl
  if (!INTERNAL_HOSTS.has(new URL(input.url).hostname)) return input.url
  return input.serverUrl ?? input.url
}

export function voiceStreamUrl(controlPlane: string, voiceId: string) {
  const base = new URL(controlPlane.replace(/\/+$/, ""))
  const wsBase = base.origin.replace(/^https:/, "wss:").replace(/^http:/, "ws:")
  return `${wsBase}/voice/session/${voiceId}/stream`
}
