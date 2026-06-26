export const PERIODIC_INTERVAL_S = 10

export type HarnessPhase = "listening" | "working" | "speaking"

export type HarnessRouteDecision = "submit_turn" | "redirect" | "interrupt" | "status" | "ignore"

export type HarnessActionKind =
  | "trace"
  | "submit_turn"
  | "redirect"
  | "interrupt"
  | "speak"
  | "set_phase"
  | "expect_reply"
  | "clear_expect_reply"

export type HarnessAction = {
  action: HarnessActionKind
  text?: string
  turnId?: number
  phase?: HarnessPhase | string
  trigger?: string
}

export type HarnessUpdate = {
  event?: string
  kind?: string
  working?: boolean
  text?: string
  detail?: string
  reply?: string
  progress?: Record<string, unknown>
  reads?: unknown
  searches?: unknown
  lists?: unknown
  shell?: unknown
  thinking?: unknown
}

export type ChatCompleteInput = {
  system: string
  user: string
  maxTokens: number
  temperature?: number
}

export type ChatComplete = (input: ChatCompleteInput) => Promise<string>
