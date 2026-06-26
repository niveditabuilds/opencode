import { looksLikeLongForm, stripMarkdownInline, voiceSummary } from "@opencode-ai/voice-harness/summary"

export {
  looksLikeLongForm,
  speakText,
  splitSentences,
  stripMarkdownInline,
  voiceSummary,
} from "@opencode-ai/voice-harness/summary"

export function pickOfferPhrase() {
  const phrases = [
    "Want me to give you more details?",
    "Should I go into more detail?",
    "Would you like to hear more?",
  ]
  return phrases[Math.floor(Math.random() * phrases.length)] ?? phrases[0]!
}

export function extractClosingQuestion(text: string) {
  const stripped = text.trim()
  if (!stripped) return null
  const flattened = stripMarkdownInline(stripped.replaceAll("\n", " "))
  const idx = flattened.lastIndexOf("?")
  if (idx === -1) return null
  const start = Math.max(flattened.lastIndexOf(".", idx), flattened.lastIndexOf("!", idx), -1)
  const candidate = flattened.slice(start + 1, idx + 1).trim()
  if (candidate.length >= 3) return candidate
  const lines = stripped
    .split("\n")
    .map((line) => stripMarkdownInline(line.trim()))
    .filter(Boolean)
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    if (line?.endsWith("?")) return line
  }
  return null
}

export function buildActionOffer(closing: string) {
  let body = closing.replace(/\?$/, "").trim()
  const lower = body.toLowerCase()
  for (const prefix of ["want me to ", "should i ", "would you like me to ", "do you want me to "]) {
    if (lower.startsWith(prefix)) {
      body = body.slice(prefix.length).trim()
      break
    }
  }
  if (!body) body = closing.replace(/\?$/, "").trim()
  const first = body.charAt(0).toLowerCase() + body.slice(1)
  return `Want me to read more, or go ahead and ${first}?`
}

export function planFinalSpeech(text: string) {
  const full = text.trim()
  const gist = voiceSummary(full)
  if (!gist) {
    return { parts: [] as string[], hasOffer: false, fullText: full, closingQuestion: null, actionOffer: false }
  }
  const parts = [gist]
  const hasOffer = looksLikeLongForm(full) || full.length > gist.length + 15
  const closing = hasOffer ? extractClosingQuestion(full) : null
  if (hasOffer) parts.push(closing ? buildActionOffer(closing) : pickOfferPhrase())
  return {
    parts,
    hasOffer,
    fullText: full,
    closingQuestion: closing,
    actionOffer: Boolean(closing),
  }
}
