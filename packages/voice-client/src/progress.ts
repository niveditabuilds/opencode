import type { Part, ToolPart } from "@opencode-ai/sdk/v2"
import type { VoiceProgressItem, VoiceProgressSnapshot } from "./api"

const MAX_ITEMS = 12
const MAX_DETAIL = 120
const MAX_SCREEN = 900
const MAX_TEXT_TAIL = 160

export function buildVoiceProgressSnapshot(parts: Part[]): VoiceProgressSnapshot {
  const items: VoiceProgressItem[] = []
  let thinking = false

  for (const part of parts) {
    if (part.type === "tool") {
      if (part.tool === "todowrite") continue
      const item = describeTool(part)
      if (!item) continue
      items.push(item)
      if (item.status === "running" || item.status === "pending") thinking = true
      continue
    }
    if (part.type === "reasoning") {
      const item = describeReasoning(part)
      if (!item) continue
      items.push(item)
      if (item.status === "running") thinking = true
      continue
    }
    if (part.type === "text") {
      if (part.synthetic || part.ignored || !part.text.trim()) continue
      const item = describeText(part)
      if (!item) continue
      items.push(item)
      if (item.status === "running") thinking = true
      continue
    }
    if (part.type === "subtask") {
      items.push({
        kind: "subtask",
        status: "running",
        label: "Running subtask",
        detail: truncate(part.description.trim() || part.prompt.trim(), MAX_DETAIL),
      })
      thinking = true
    }
  }

  const trail = items.slice(-MAX_ITEMS)
  const current = pickCurrent(trail)
  const screen = buildScreen(trail, current).slice(0, MAX_SCREEN)

  return { screen, items: trail, current, thinking }
}

export function collectActiveTurnParts(input: {
  messages: Array<{ id: string; role: string; parentID?: string }>
  partsForMessage: (messageID: string) => Part[]
  activeUserMessageID?: string
}) {
  if (!input.activeUserMessageID) return []
  const parts: Part[] = []
  for (const message of input.messages) {
    if (message.role !== "assistant") continue
    if (message.parentID !== input.activeUserMessageID) continue
    parts.push(...input.partsForMessage(message.id))
  }
  return parts
}

function describeTool(part: ToolPart): VoiceProgressItem | undefined {
  const status = part.state.status
  const input = part.state.input ?? {}
  let label = toolLabel(part.tool, input)
  if (status === "completed" || status === "running") {
    const title = part.state.title?.trim()
    if (title) label = title
  }
  const detail = toolDetail(part.tool, input)
  const error = status === "error" ? part.state.error?.trim() : undefined
  return {
    kind: "tool",
    status,
    label,
    detail: error ? truncate(error, MAX_DETAIL) : detail ? truncate(detail, MAX_DETAIL) : undefined,
  }
}

function describeReasoning(part: Extract<Part, { type: "reasoning" }>): VoiceProgressItem | undefined {
  const text = part.text.trim()
  if (!text) return undefined
  const active = !part.time.end
  const detail = truncate(reasoningHeadline(text) || cleanLine(text), MAX_DETAIL)
  return {
    kind: "reasoning",
    status: active ? "running" : "done",
    label: active ? "Thinking" : "Thought",
    detail,
  }
}

function describeText(part: Extract<Part, { type: "text" }>): VoiceProgressItem | undefined {
  const text = part.text.trim()
  if (!text) return undefined
  const active = !part.time?.end
  return {
    kind: "text",
    status: active ? "running" : "done",
    label: active ? "Writing reply" : "Reply",
    detail: truncate(cleanLine(text), active ? MAX_TEXT_TAIL : MAX_DETAIL),
  }
}

function pickCurrent(items: VoiceProgressItem[]) {
  for (let index = items.length - 1; index >= 0; index--) {
    const item = items[index]
    if (!item) continue
    if (item.status === "running" || item.status === "pending") return formatItemLine(item)
  }
  const last = items.at(-1)
  return last ? formatItemLine(last) : undefined
}

function buildScreen(items: VoiceProgressItem[], current?: string) {
  const lines: string[] = []
  if (current) lines.push(`Now: ${current}`)
  for (const item of items.slice(-6)) {
    const line = formatItemLine(item)
    if (line === current) continue
    lines.push(line)
  }
  return lines.join("\n").trim()
}

function formatItemLine(item: VoiceProgressItem) {
  const detail = item.detail ? `: ${item.detail}` : ""
  if (item.status === "running" || item.status === "pending") return `${item.label}${detail} (in progress)`
  if (item.status === "error") return `${item.label}${detail} (failed)`
  return `${item.label}${detail}`
}

function toolLabel(tool: string, input: Record<string, unknown>) {
  switch (tool) {
    case "read":
      return `Reading ${fileLabel(input.filePath)}`
    case "list":
      return `Listing ${fileLabel(input.path)}`
    case "glob":
      return `Searching files ${stringField(input.pattern)}`
    case "grep":
      return `Searching code ${stringField(input.pattern)}`
    case "bash":
      return stringField(input.description) ? `Running ${stringField(input.description)}` : "Running shell command"
    case "edit":
      return `Editing ${fileLabel(input.filePath)}`
    case "write":
      return `Writing ${fileLabel(input.filePath)}`
    case "apply_patch":
      return "Applying patch"
    case "webfetch":
      return "Fetching page"
    case "websearch":
      return `Searching web ${stringField(input.query)}`
    case "task":
      return stringField(input.description) ? `Task: ${stringField(input.description)}` : "Running task"
    case "question":
      return "Asking a question"
    case "skill":
      return stringField(input.name) ? `Using skill ${stringField(input.name)}` : "Using skill"
    default:
      return tool.replaceAll("_", " ")
  }
}

function toolDetail(tool: string, input: Record<string, unknown>) {
  switch (tool) {
    case "read":
    case "edit":
    case "write":
      return fileLabel(input.filePath) || undefined
    case "list":
      return fileLabel(input.path) || undefined
    case "glob":
    case "grep":
      return stringField(input.pattern) || undefined
    case "bash":
      return stringField(input.description) || truncate(stringField(input.command), MAX_DETAIL) || undefined
    case "webfetch":
      return truncate(stringField(input.url), MAX_DETAIL) || undefined
    case "websearch":
      return stringField(input.query) || undefined
    case "task":
      return stringField(input.description) || undefined
    case "apply_patch":
      return Array.isArray(input.files) ? `${input.files.length} files` : undefined
    default:
      return undefined
  }
}

function reasoningHeadline(text: string) {
  const markdown = text.replace(/\r\n?/g, "\n")
  const html = markdown.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i)
  if (html?.[1]) {
    const value = cleanLine(html[1].replace(/<[^>]+>/g, " "))
    if (value) return value
  }
  const atx = markdown.match(/^\s{0,3}#{1,6}[ \t]+(.+?)(?:[ \t]+#+[ \t]*)?$/m)
  if (atx?.[1]) return cleanLine(atx[1])
  const first = markdown.split("\n").find((line) => line.trim())
  return first ? cleanLine(first) : undefined
}

function cleanLine(text: string) {
  return text
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_~]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

function fileLabel(value: unknown) {
  const path = stringField(value)
  if (!path) return "file"
  const parts = path.split(/[/\\]/)
  return parts.at(-1) || path
}

function stringField(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function truncate(text: string, max: number) {
  const trimmed = text.trim()
  if (trimmed.length <= max) return trimmed
  return `${trimmed.slice(0, max).replace(/\s+\S*$/, "").trim()}…`
}
