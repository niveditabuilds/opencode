export function sessionInterruptAgent(input: {
  sessionID: () => string | undefined
  abortSession: (sessionID: string) => Promise<unknown>
}) {
  return () => {
    const sessionID = input.sessionID()
    if (!sessionID) return
    void input.abortSession(sessionID).catch(() => {})
  }
}
