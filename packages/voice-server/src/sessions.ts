import { randomBytes } from "node:crypto"
import { resolve } from "node:path"

export type VoiceSession = {
  id: string
  opencodeUrl: string
  controlPlaneUrl: string
  opencodeSessionId: string
  directory: string
  agent: string | undefined
  composer: boolean
  createdAt: number
}

export type CreateSessionInput = {
  directory: string
  sessionID?: string
  agent?: string
  composer?: boolean
  server?: string
}

export class VoiceSessionStore {
  #sessions = new Map<string, VoiceSession>()

  create(input: {
    opencodeUrl: string
    controlPlaneUrl: string
    opencodeSessionId: string
    directory: string
    agent: string | undefined
    composer: boolean
  }) {
    const session: VoiceSession = {
      id: `vs_${randomBytes(9).toString("base64url")}`,
      opencodeUrl: input.opencodeUrl,
      controlPlaneUrl: input.controlPlaneUrl.replace(/\/+$/, ""),
      opencodeSessionId: input.opencodeSessionId,
      directory: resolve(input.directory),
      agent: input.agent,
      composer: input.composer,
      createdAt: Date.now(),
    }
    this.#sessions.set(session.id, session)
    return session
  }

  get(voiceId: string) {
    return this.#sessions.get(voiceId)
  }

  drop(voiceId: string) {
    this.#sessions.delete(voiceId)
  }
}

export function streamUrl(base: URL, voiceId: string) {
  const wsBase = base.origin.replace(/^https:/, "wss:").replace(/^http:/, "ws:")
  return `${wsBase}/voice/session/${voiceId}/stream`
}

export function sessionJson(session: VoiceSession) {
  return {
    id: session.id,
    stream: streamUrl(new URL(session.controlPlaneUrl), session.id),
    opencode: {
      url: session.opencodeUrl,
      sessionID: session.opencodeSessionId,
      directory: session.directory,
      agent: session.agent,
    },
    createdAt: session.createdAt,
  }
}

export const voiceSessions = new VoiceSessionStore()
