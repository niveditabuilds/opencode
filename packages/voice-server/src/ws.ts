type AuthorizedWebSocket = new (url: string, options: { headers: Record<string, string> }) => WebSocket

export function authorizedWebSocket(url: string, apiKey: string) {
  const Ctor = WebSocket as unknown as AuthorizedWebSocket
  return new Ctor(url, { headers: { Authorization: `Bearer ${apiKey}` } })
}
