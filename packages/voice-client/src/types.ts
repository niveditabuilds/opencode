export type VoicePhase = "off" | "listening" | "hearing" | "working" | "speaking"

export type TuiVoicePhase = VoicePhase

export const SILENT_WAV =
  "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAA="

export type VoiceOptions = {
  transport?: "terminal" | "browser"
  sidecarUrl?: () => string
  opencodeUrl: () => string
  serverUrl?: () => string | undefined
  directory: () => string
  sessionID: () => string | undefined
  agent: () => string | undefined
  enabled: () => boolean
  working: () => boolean
  submitTranscript: (text: string) => void
  onTranscript?: (text: string) => void
  assistantReplyForVoiceTurn?: () => string | undefined
  progressSnapshot?: () => import("./api").VoiceProgressSnapshot | undefined
  interruptAgent?: () => void
  pendingQuestion?: () => import("@opencode-ai/sdk/v2").QuestionRequest | undefined
  pendingPermission?: () => import("@opencode-ai/sdk/v2").PermissionRequest | undefined
  replyQuestion?: (input: {
    requestID: string
    answers: import("@opencode-ai/sdk/v2").QuestionAnswer[]
  }) => void
  rejectQuestion?: (input: { requestID: string }) => void
  replyPermission?: (input: { requestID: string; reply: "once" | "always" | "reject" }) => void
  onError: (message: string) => void
}

export type TuiVoiceOptions = VoiceOptions
